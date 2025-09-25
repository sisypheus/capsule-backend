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

  async applyDeployment(namespace: string, appName: string, imageUri: string) {
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
              { name: appName, image: imageUri, ports: [{ containerPort: 80 }] }
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

  async applyService(namespace: string, appName: string) {
    this.logger.log(`Applying Service: ${appName} in ${namespace}`);
    const manifest: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: appName },
      spec: {
        selector: { app: appName },
        ports: [{ port: 80, targetPort: 80 }],
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
  ): Promise<any> {
    this.logger.log(
      `Waiting for deployment ${appName} in namespace ${namespace} to be ready...`
    );

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const interval = setInterval(async () => {
        if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          reject(
            new Error(`Timeout waiting for deployment rollout for ${appName}.`)
          );
          return;
        }

        try {
          const deployment = await this.k8sAppsApi.readNamespacedDeployment({
            name: appName,
            namespace
          });
          const status = deployment.status;

          if (
            status &&
            status.updatedReplicas === deployment.spec?.replicas &&
            status.replicas === status.updatedReplicas &&
            status.availableReplicas === status.replicas
          ) {
            clearInterval(interval);
            this.logger.log(`Deployment ${appName} is ready.`);
            resolve('');
          } else {
            this.logger.log(
              `[${appName}] Waiting... Replicas: ${status?.availableReplicas || 0}/${deployment.spec?.replicas}`
            );
          }
        } catch (error: any) {
          clearInterval(interval);
          this.logger.error(
            `Error while waiting for deployment ${appName}:`,
            error.body || error
          );
          reject(new Error(error));
        }
      }, 5000);
    });
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
