import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      log: ['query', 'info', 'warn', 'error'], // Включите логирование для отладки
    });
  }

  // Подключение к базе данных при старте приложения
  async onModuleInit() {
    await this.$connect();
  }

  // Закрытие соединения при завершении работы приложения
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
