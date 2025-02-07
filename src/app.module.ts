import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HttpModule } from '@nestjs/axios';
import { NeuralService } from './neural.service';
import { NeuralController } from 'src/neural.controller';
import { PrismaService } from 'src/prisma.service';
@Module({
  imports: [HttpModule],
  controllers: [AppController, NeuralController],
  providers: [AppService, NeuralService, PrismaService],
})
export class AppModule {}
