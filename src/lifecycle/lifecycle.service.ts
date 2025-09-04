import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { Supabase } from 'src/supabase/supabase.service';

@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);
  private readonly deploymentTtlMinutes: number;

  constructor(
    private readonly kubernetesService: KubernetesService,
    private readonly configService: ConfigService,
    private readonly db: Supabase
  ) {
    this.deploymentTtlMinutes = +this.configService.get<number>(
      'DEPLOYMENT_TTL_MINUTES',
      60
    );
    this.logger.log(
      `Durée de vie des déploiements configurée à ${this.deploymentTtlMinutes} minutes.`
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    const { data: activeDeployments, error } = await this.db
      .from('deployments')
      .select('*')
      .eq('status', 'active');

    if (error) {
      this.logger.error(
        'Erreur lors de la récupération des déploiements actifs.',
        error.message
      );
      return;
    }

    if (!activeDeployments || activeDeployments.length === 0) return;

    const now = new Date();
    const expiredDeployments = activeDeployments.filter((dep) => {
      const createdAt = new Date(dep.created_at);
      const minutesSinceCreation =
        (now.getTime() - createdAt.getTime()) / (1000 * 60);
      return minutesSinceCreation > this.deploymentTtlMinutes;
    });

    if (expiredDeployments.length === 0) return;

    this.logger.log(
      `${expiredDeployments.length} déploiement(s) expiré(s) trouvé(s). Début du nettoyage...`
    );

    for (const deployment of expiredDeployments) {
      this.logger.log(
        `Nettoyage du déploiement ID: ${deployment.id}, Namespace: ${deployment.namespace}`
      );
      try {
        await this.kubernetesService.cleanupNamespace(deployment.namespace);

        const { error: updateError } = await this.db
          .from('deployments')
          .update({ status: 'destroyed' })
          .eq('id', deployment.id);

        if (updateError) {
          this.logger.error(
            `Échec de la mise à jour du statut pour le déploiement ${deployment.id}`,
            updateError.message
          );
        } else {
          this.logger.log(
            `Déploiement ${deployment.id} marqué comme 'destroyed'.`
          );
        }
      } catch (cleanupError) {
        this.logger.error(
          `Erreur lors du nettoyage du namespace ${deployment.namespace}`,
          cleanupError?.message
        );
      }
    }
  }
}
