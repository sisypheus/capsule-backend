import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';

@Injectable()
export class KubernetesService {
  private readonly kc: k8s.KubeConfig;
  private readonly k8sCoreApi: k8s.CoreV1Api;
  private readonly k8sAppsApi: k8s.AppsV1Api;
  private readonly k8sNetworkingApi: k8s.NetworkingV1Api;
  private readonly logger = new Logger(KubernetesService.name);

  constructor() {
    this.kc = new k8s.KubeConfig();
    if (process.env.KUBERNETES_SERVICE_HOST) {
      this.logger.log('Loading KubeConfig from cluster...');
      this.kc.loadFromCluster();
    } else {
      this.logger.log('Loading KubeConfig from default local path...');
      this.kc.loadFromDefault();
    }

    this.k8sCoreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.k8sNetworkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
  }

  private async applyResource<T extends k8s.KubernetesObject>(
    manifest: T,
    readCall: () => Promise<any>,
    createCall: (manifest: T) => Promise<any>,
    replaceCall: (manifest: T) => Promise<any>
  ) {
    const name = manifest.metadata?.name;
    const kind = manifest.kind;

    try {
      await readCall();
      this.logger.log(`${kind} '${name}' already exists. Replacing...`);
      await replaceCall(manifest);
      this.logger.log(`${kind} '${name}' replaced successfully.`);
    } catch (e) {
      if (this.isNotFoundError(e)) {
        this.logger.log(`${kind} '${name}' not found. Creating...`);
        await createCall(manifest);
        this.logger.log(`${kind} '${name}' created successfully.`);
      } else {
        this.logger.error(
          `Failed to apply ${kind} '${name}':`,
          e.body || e.message
        );
        throw e;
      }
    }
  }

  private isNotFoundError(e: any): boolean {
    if (e?.body?.code === 404) {
      return true;
    }

    if (typeof e?.body === 'string') {
      try {
        const errorBody = JSON.parse(e.body);
        if (errorBody.code === 404) {
          return true;
        }
      } catch {
        return false;
      }
    }

    if (e?.response?.statusCode === 404) {
      return true;
    }

    return false;
  }

  async applyNamespace(name: string) {
    this.logger.log(`Applying Namespace: ${name}`);
    const manifest: k8s.V1Namespace = {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name }
    };

    await this.applyResource(
      manifest,
      () => this.k8sCoreApi.readNamespace({ name }),
      (m) => this.k8sCoreApi.createNamespace({ body: m }),
      (m) => this.k8sCoreApi.replaceNamespace({ name, body: m })
    );
  }

  async applyDeployment(
    namespace: string,
    appName: string,
    imageUri: string,
    port: number
  ) {
    this.logger.log(`Applying Deployment: ${appName} in ${namespace}`);
    const manifest: k8s.V1Deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: appName },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: appName } },
        template: {
          metadata: { labels: { app: appName } },
          spec: {
            containers: [
              {
                name: appName,
                image: imageUri,
                ports: [{ containerPort: port }]
              }
            ]
          }
        }
      }
    };

    await this.applyResource(
      manifest,
      () =>
        this.k8sAppsApi.readNamespacedDeployment({
          name: appName,
          namespace: namespace
        }),
      (m) => this.k8sAppsApi.createNamespacedDeployment({ namespace, body: m }),
      (m) =>
        this.k8sAppsApi.replaceNamespacedDeployment({
          name: appName,
          namespace,
          body: m
        })
    );
  }

  async applyService(namespace: string, appName: string, port: number) {
    this.logger.log(`Applying Service: ${appName} in ${namespace}`);
    const manifest: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: appName },
      spec: {
        selector: { app: appName },
        ports: [{ port: 80, targetPort: port }],
        type: 'ClusterIP'
      }
    };

    await this.applyResource(
      manifest,
      () => this.k8sCoreApi.readNamespacedService({ name: appName, namespace }),
      (m) => this.k8sCoreApi.createNamespacedService({ namespace, body: m }),
      (m) =>
        this.k8sCoreApi.replaceNamespacedService({
          name: appName,
          namespace,
          body: m
        })
    );
  }

  async applyIngress(namespace: string, appName: string, url: string) {
    this.logger.log(`Applying Ingress: ${appName} in ${namespace}`);
    const host = new URL(url).hostname;
    const manifest: k8s.V1Ingress = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: appName,
        annotations: {
          'kubernetes.io/ingress.class': 'traefik',
          'cert-manager.io/cluster-issuer': 'letsencrypt-prod'
        }
      },
      spec: {
        tls: [
          {
            hosts: [host],
            secretName: `${appName}-tls`
          }
        ],
        rules: [
          {
            host,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: { service: { name: appName, port: { number: 80 } } }
                }
              ]
            }
          }
        ]
      }
    };

    await this.applyResource(
      manifest,
      () =>
        this.k8sNetworkingApi.readNamespacedIngress({
          name: appName,
          namespace
        }),
      (m) =>
        this.k8sNetworkingApi.createNamespacedIngress({ namespace, body: m }),
      (m) =>
        this.k8sNetworkingApi.replaceNamespacedIngress({
          name: appName,
          namespace,
          body: m
        })
    );
  }

  async waitForDeployment(
    namespace: string,
    appName: string,
    timeout = 300000 // 5 minutes
  ): Promise<void> {
    this.logger.log(
      `Waiting for deployment ${appName} in namespace ${namespace} to be ready...`
    );

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const interval = setInterval(async () => {
        if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          const podEvents = await this.getLatestPodEvents(namespace, appName);
          reject(
            new Error(
              `Timeout waiting for deployment rollout for ${appName}. Last pod events:\n${podEvents}`
            )
          );
          return;
        }

        try {
          const deployment = await this.k8sAppsApi.readNamespacedDeployment({
            name: appName,
            namespace
          });

          const spec = deployment.spec;
          const status = deployment.status;

          if (status && spec && status.availableReplicas === spec.replicas) {
            if (
              status.updatedReplicas === spec.replicas &&
              status.replicas === spec.replicas
            ) {
              clearInterval(interval);
              this.logger.log(`Deployment ${appName} is ready.`);
              resolve();
            } else {
              this.logger.log(
                `[${appName}] Waiting for rollout... Ready: ${status.availableReplicas || 0}, Updated: ${status.updatedReplicas || 0}, Total: ${status.replicas || 0}`
              );
            }
          } else {
            this.logger.log(
              `[${appName}] Waiting... Replicas available: ${status?.availableReplicas || 0}/${spec?.replicas || 'N/A'}`
            );
          }
        } catch (error: any) {
          clearInterval(interval);
          this.logger.error(
            `Error while waiting for deployment ${appName}:`,
            error.body?.message || error.message
          );
          reject(new Error(error));
        }
      }, 5000);
    });
  }

  private async getLatestPodEvents(
    namespace: string,
    appName: string
  ): Promise<string> {
    try {
      const labelSelector = `app=${appName}`;
      const podList = await this.k8sCoreApi.listNamespacedPod({
        labelSelector,
        namespace
      });
      if (podList.items.length === 0) {
        return 'No pods found for this deployment.';
      }
      const latestPod = podList.items.sort(
        (a, b) =>
          new Date(b.metadata?.creationTimestamp || '').getTime() -
          new Date(a.metadata?.creationTimestamp || '').getTime()
      )[0];
      const podName = latestPod.metadata?.name;

      const eventList = await this.k8sCoreApi.listNamespacedEvent({
        namespace,
        labelSelector: `involvedObject.name=${podName}`
      });
      if (eventList.items.length === 0) {
        return `No events found for the latest pod ${podName}. Pod status: ${latestPod.status?.phase}`;
      }
      return eventList.items
        .map((e) => `- ${e.type} (${e.reason}): ${e.message}`)
        .join('\n');
    } catch (e) {
      console.log(e);
      return 'Could not retrieve pod events.';
    }
  }

  async cleanupNamespace(namespace: string) {
    try {
      await this.k8sCoreApi.deleteNamespace({ name: namespace });
      this.logger.log(`Namespace ${namespace} nettoyé avec succès.`);
    } catch (err: any) {
      this.logger.error(
        `Impossible de nettoyer le namespace ${namespace}: ${err?.body?.message ?? err?.message ?? String(err)}`
      );
    }
  }
}
