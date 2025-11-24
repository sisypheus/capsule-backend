import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { LogsGateway } from 'src/logs/logs.gateway';
import * as stream from 'stream';

@Injectable()
export class KubernetesService {
  private readonly kc: k8s.KubeConfig;
  private readonly logger = new Logger(KubernetesService.name);
  private readonly k8BatchApi: k8s.BatchV1Api;
  private readonly k8sCoreApi: k8s.CoreV1Api;
  private readonly k8sAppsApi: k8s.AppsV1Api;
  private readonly k8sNetworkingApi: k8s.NetworkingV1Api;

  constructor(private readonly logsGateway: LogsGateway) {
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
    this.k8BatchApi = this.kc.makeApiClient(k8s.BatchV1Api);
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
            automountServiceAccountToken: false,
            securityContext: {
              runAsNonRoot: true,
            },
            containers: [
              {
                name: appName,
                image: imageUri,
                ports: [{ containerPort: port }],
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                },
                resources: {
                  limits: {
                    memory: '256Mi',
                    cpu: '200m'
                  },
                  requests: {
                    memory: '128Mi',
                    cpu: '100m'
                  }
                }
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

  async createRegistrySecret(namespace: string) {
    const authString = Buffer.from(
      `${process.env.REGISTRY_USER}:${process.env.REGISTRY_PASSWORD}`
    ).toString('base64');
    const dockerConfig = {
      auths: { [process.env.REGISTRY_URL as string]: { auth: authString } }
    };
    const dockerConfigJson = Buffer.from(JSON.stringify(dockerConfig)).toString(
      'base64'
    );

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'registry-secret' },
      type: 'kubernetes.io/dockerconfigjson',
      data: { '.dockerconfigjson': dockerConfigJson }
    };
    await this.k8sCoreApi.createNamespacedSecret({
      namespace: namespace,
      body: secret
    });
  }

  async createNamespace(namespacedObject) {
    return this.k8sCoreApi.createNamespace(namespacedObject);
  }

  async createNamespacedJob({ jobManifest, namespace }) {
    return this.k8BatchApi.createNamespacedJob({
      body: jobManifest,
      namespace
    });
  }

  async waitForDeployment(
    namespace: string,
    appName: string,
    timeout = 300000
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

  async waitForJobPod(namespace: string, jobName: string, timeoutMs = 120000) {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await this.k8sCoreApi.listNamespacedPod({
          namespace,
          labelSelector: `job-name=${jobName}`
        });

        if (res.items && res.items.length > 0) return res.items[0];

        this.logger.debug(`Waiting for pod creation for job ${jobName}...`);
      } catch (error) {
        this.logger.warn(`Error listing pods for job ${jobName}:`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(
      `Pod for job ${jobName} was not created within ${timeoutMs}ms`
    );
  }

  async waitForPodReady(namespace: string, podName: string, timeoutMs = 60000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const pod = await this.k8sCoreApi.readNamespacedPod({
        name: podName,
        namespace
      });
      const phase = pod.status?.phase;

      if (phase === 'Running') {
        return pod;
      }
      if (phase === 'Failed') {
        console.warn('Pod failed, attempting to retrieve logs anyway');
        return pod;
      }
      if (phase === 'Succeeded') {
        console.warn(
          'Pod already succeeded, attempting to retrieve logs anyway'
        );
        return pod;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error(`Pod ${podName} did not start within ${timeoutMs}ms`);
  }

  watchJobAndStreamLogs(
    namespace: string,
    jobName: string,
    container: string,
    deployment_id: string
  ): void {
    try {
      this.logger.log(`[${jobName}] Starting to watch job and stream logs...`);

      const k8log = new k8s.Log(this.kc);
      const logStream = new stream.PassThrough();

      logStream.on('data', (chunk) => {
        const data = chunk.toString('utf8');
        this.logsGateway.sendLog(deployment_id, data);
      });

      logStream.on('error', (error) => {
        this.logger.error(`Log stream error for ${jobName}:`, error);
      });

      k8log
        .log(namespace, jobName, container, logStream, {
          follow: true,
          tailLines: 50,
          pretty: false,
          timestamps: true
        })
        .catch((error) => {
          this.logger.error(`Log stream error:`, error);
        });
    } catch (error) {
      this.logger.error(`Failed to watch job ${jobName}:`, error);
      throw error;
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
