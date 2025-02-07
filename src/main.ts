import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Получение PrismaService из IoC контейнера NestJS
  const prismaService = app.get(PrismaService);
  app.enableShutdownHooks(); // Подключение хуков завершения работы
  await prismaService.onModuleInit();

  await app.listen(3000);
}
bootstrap();
