import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true
  }
})
export class LogsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('LogsGateway');

  constructor() {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway Initialized');
  }

  handleConnection(client: Socket, ...args: any[]) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinDeploymentRoom')
  handleJoinRoom(client: Socket, deploymentId: string) {
    // TODO: Vérifier que l'utilisateur authentifié a bien le droit de voir ce déploiement.
    this.logger.log(
      `Client ${client.id} joining room for deployment ${deploymentId}`
    );
    client.join(deploymentId);
    client.emit(
      'joinedRoom',
      `Successfully joined room for deployment ${deploymentId}`
    );
  }

  sendLog(deploymentId: string, message: string) {
    this.server.to(deploymentId).emit('logMessage', message);
  }
}
