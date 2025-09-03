import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import * as short from 'short-uuid';

@Injectable()
export class KubernetesService {
  private readonly kc: k8s.KubeConfig;
  private readonly k8sCoreApi: k8s.CoreV1Api;
  private readonly k8sAppsApi: k8s.AppsV1Api;
  private readonly k8sNetworkingApi: k8s.NetworkingV1Api;
  private readonly logger = new Logger(KubernetesService.name);

  constructor() {
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromDefault();

    this.k8sCoreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.k8sNetworkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
  }

  async deployApplication(
    imageName: string
  ): Promise<{ namespace: string; ingressUrl: string }> {
    const namespace = `paas-${short.generate()}`.toLowerCase();
    const appName = 'app';

    this.logger.log(`Début du déploiement dans le namespace: ${namespace}`);

    try {
      console.log(namespace);
      this.logger.log(`Création du namespace...`);
      await this.k8sCoreApi.createNamespace({
        body: {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: { name: namespace }
        }
      });

      const deploymentManifest = this.createDeploymentManifest(
        appName,
        imageName,
        namespace
      );
      this.logger.log(`Création du déploiement...`);
      await this.k8sAppsApi.createNamespacedDeployment({
        namespace,
        body: deploymentManifest
      });

      const serviceManifest = this.createServiceManifest(appName, namespace);
      this.logger.log(`Création du service...`);
      await this.k8sCoreApi.createNamespacedService({
        namespace,
        body: serviceManifest
      });

      const { ingressManifest, ingressUrl } = this.createIngressManifest(
        appName,
        namespace
      );
      this.logger.log(`Création de l'ingress sur l'URL: ${ingressUrl}`);
      await this.k8sNetworkingApi.createNamespacedIngress({
        namespace,
        body: ingressManifest
      });

      this.logger.log(`Déploiement réussi pour le namespace ${namespace}`);
      return { namespace, ingressUrl };
    } catch (err: any) {
      this.logger.error(
        `Échec du déploiement pour ${namespace}. Tentative de nettoyage...`,
        err?.stack ?? err
      );
      await this.cleanupNamespace(namespace);
      throw new Error(
        `Kubernetes deployment failed: ${err?.body?.message ?? err?.message ?? String(err)}`
      );
    }
  }

  private createDeploymentManifest(
    appName: string,
    imageName: string,
    namespace: string
  ): k8s.V1Deployment {
    return {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: appName, namespace },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: appName } },
        template: {
          metadata: { labels: { app: appName } },
          spec: {
            containers: [
              {
                name: appName,
                image: imageName,
                ports: [{ containerPort: 80 }]
              }
            ]
          }
        }
      }
    } as k8s.V1Deployment;
  }

  private createServiceManifest(
    appName: string,
    namespace: string
  ): k8s.V1Service {
    return {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: appName, namespace },
      spec: {
        selector: { app: appName },
        ports: [{ port: 80, targetPort: 80 }],
        type: 'ClusterIP'
      }
    } as k8s.V1Service;
  }

  private createIngressManifest(
    appName: string,
    namespace: string
  ): { ingressManifest: k8s.V1Ingress; ingressUrl: string } {
    const host = `${namespace}.127.0.0.1.nip.io`;
    const ingressUrl = `http://${host}:8081`;

    const ingressManifest: k8s.V1Ingress = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { name: appName, namespace },
      spec: {
        rules: [
          {
            host: host,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: appName,
                      port: { number: 80 }
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    } as k8s.V1Ingress;

    return { ingressManifest, ingressUrl };
  }

  async cleanupNamespace(namespace: string) {
    try {
      // await this.k8sCoreApi.deleteNamespace({ name: namespace });
      await this.k8sCoreApi.deleteNamespace({ name: namespace });
      this.logger.log(`Namespace ${namespace} nettoyé avec succès.`);
    } catch (err: any) {
      this.logger.error(
        `Impossible de nettoyer le namespace ${namespace}: ${err?.body?.message ?? err?.message ?? String(err)}`
      );
    }
  }
}
