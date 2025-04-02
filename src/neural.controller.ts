import prompt from './prompt';
import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { NeuralService } from './neural.service';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import type { MinecraftData } from './neural.service';
type Data = {
  text: string;
  x: number;
  y: number;
  z: number;
};
export type MinecraftDataFull = {
  id?: number;
  name: string;
  price: number;
  quantity: number;
  seller: string;
  sellerUUID: string;
  minecraft_id: string;
  typeRu: string;
  typeId: string;
  x: number;
  y: number;
  z: number;
  recordDate: string;
  benefitRation: number;
};

export type Items = {
  items: string;
  x: number;
  y: number;
  z: number;
};
const taskQueue: (() => Promise<void>)[] = []; // Очередь задач
let isProcessing = false; // Флаг обработки
@Injectable()
export class TokenGuard implements CanActivate {
  private readonly requiredTokens: string[] = process.env.REQUIRED_TOKENS
    ? process.env.REQUIRED_TOKENS.split(',').map((token) => token.trim())
    : ['MY_SECRET_TOKEN']; // дефолтное значение

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      throw new UnauthorizedException('Отсутствует заголовок авторизации');
    }
    // Ожидаем формат "Bearer <токен>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedException('Неверный формат заголовка авторизации');
    }
    const token = parts[1];
    if (!this.requiredTokens.includes(token)) {
      throw new UnauthorizedException('Неверный токен');
    }
    return true;
  }
}
@Controller('neural')
export class NeuralController {
  private prisma = new PrismaClient(); // Переносим объявление внутрь класса
  constructor(private readonly neuralService: NeuralService) {}

  @Get('all')
  async getAllMinecraftData() {
    try {
      // Запрос к базе данных для получения всех записей
      const data = await this.prisma.minecraftData.findMany();
      return data; // Возвращаем данные
    } catch (error) {
      console.error('Error retrieving data:', error.message);
      throw error; // Пробрасываем ошибку, чтобы NestJS её обработал
    }
  }
  @Get('types')
  async getTypes() {
    return this.neuralService.getTypes();
  }
  // Получение предметов по типу
  @Get('allitems')
  async getItemsByType(@Query('type') type: string) {
    return this.neuralService.getItemsByType(type);
  }
  //     карточек по minecraft_id
  @Get('barrels')
  async getBarrelsByFilters(
    @Query('minecraft_id') minecraft_id?: string,
    @Query('seller') seller?: string,
    @Query('name') name?: string,
    @Query('filter') filter?: string,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 10,
  ) {
    // Добавляем сортировку по алфавиту и по benefitRation
    const orderBy = {
      ...(filter === 'alphabet' ? { name: 'asc' } : {}), // Сортировка по имени
      ...(filter === 'benefitRation' ? { benefitRation: 'desc' } : {}), // Сортировка по benefitRation от большего к меньшему
      ...(filter !== 'alphabet' && filter !== 'benefitRation'
        ? { createdAt: 'desc' }
        : {}), // Сортировка по дате, если не выбран другой фильтр
    };

    return this.neuralService.getBarrelsByFilters(
      minecraft_id,
      seller,
      name,
      orderBy,
      page,
      pageSize,
    );
  }

  @Get('barrels/history')
  async getBarrelHistory(
    @Query('x') x: string,
    @Query('y') y: string,
    @Query('z') z: string,
  ) {
    // Преобразуем параметры из строки в числа
    const xNum = parseInt(x, 10);
    const yNum = parseInt(y, 10);
    const zNum = parseInt(z, 10);

    // Проверяем, что параметры валидные
    if (isNaN(xNum) || isNaN(yNum) || isNaN(zNum)) {
      throw new BadRequestException('Parameters x, y, and z must be numbers');
    }

    // Вызываем метод для получения данных
    return this.neuralService.getBarrelHistory(xNum, yNum, zNum);
  }
  @Post('items')
  public async postItems(
    @Body() barrelItems: Items,
  ): Promise<Items | { message: string }> {
    // Получаем начало и конец текущего дня
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    // Проверяем, есть ли уже запись с таким x, y, z и датой
    const existingEntry = await this.prisma.barrelItems.findFirst({
      where: {
        x: barrelItems.x,
        y: barrelItems.y,
        z: barrelItems.z,
        createdAt: {
          gte: todayStart, // Начало дня
          lt: todayEnd, // Конец дня
        },
      },
    });

    // Если запись уже существует, отклоняем запрос
    if (existingEntry) {
      return;
    }

    // Создаём новую запись
    const data = {
      items: barrelItems.items.replace(/[\"\/\\]/g, '') ?? '',
      x: barrelItems.x,
      y: barrelItems.y,
      z: barrelItems.z,
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const newEntry = await this.prisma.barrelItems.create({ data });
    return;
  }

  @Post()
  @UseGuards(TokenGuard)
  async handleMinecraftData(@Body() actions: Data[]) {
    return new Promise((resolve, reject) => {
      // Добавляем запрос в очередь
      taskQueue.push(() =>
        this.processRequest(actions).then(resolve).catch(reject),
      );

      // Если обработка ещё не идёт, запускаем её
      if (!isProcessing) {
        this.processQueue();
      }
    });
  }
  private async processQueue() {
    if (isProcessing || taskQueue.length === 0) return;

    isProcessing = true;

    while (taskQueue.length > 0) {
      const task = taskQueue.shift(); // Берём первую задачу из очереди
      if (task) {
        await task(); // Выполняем её
      }
    }

    isProcessing = false; // Разрешаем обработку новых задач
  }

  private async processRequest(actions: Data[]) {
    const batchSize = 6; // Размер батча
    const slicedActions = this.SliceArray(actions, batchSize);
    const resultData: MinecraftDataFull[] = [];

    for (let i = 0; i < slicedActions.length; i++) {
      const apiKey =
        i % 2 === 0
          ? process.env.TOGETHER_API_KEY_FIRST
          : process.env.TOGETHER_API_KEY_SECOND;

      await new Promise((resolve) => setTimeout(resolve, 61000)); // Задержка между батчами

      await Promise.all(
        slicedActions[i].map(async (Action: Data, index) => {
          await new Promise((resolve) => setTimeout(resolve, 1100 * index));
          const data: MinecraftDataFull = await this.processAction(
            Action,
            apiKey,
          );
          resultData.push(data);
        }),
      );

      if (resultData.length >= batchSize) {
        const filteredData = resultData.filter((item) => item !== null);
        if (filteredData.length > 0) {
          await this.prisma.minecraftData.createMany({ data: filteredData });
          console.log('Отправлено:', filteredData.length, 'записей');
        }
        resultData.length = 0;
      }
    }

    if (resultData.length > 0) {
      const filteredData = resultData.filter((item) => item !== null);
      if (filteredData.length > 0) {
        await this.prisma.minecraftData.createMany({ data: filteredData });
        console.log(
          'Отправлена неполная пачка:',
          filteredData.length,
          'записей',
        );
      }
    } else {
      console.log('Нет данных для отправки');
    }
  }

  // Функция обработки одного действия
  private async processAction(action: Data, apiKey: string) {
    const { text, x, y, z } = action;
    const sanitizedText = this.neuralService.sanitizeText(text);
    const actionsText = `${prompt} Вход: ${sanitizedText} Результат: `;
    const todayString = await this.neuralService.formatDateToString(new Date());

    // Параллельный запуск двух запросов к ИИ с разными API-ключами
    const neuralResponse: MinecraftData = await this.neuralService.processData(
      actionsText,
      apiKey,
    );

    // Выбираем тот ответ, который удовлетворяет условиям валидности

    if (!neuralResponse) {
      console.warn(
        'Нейросервисы не вернули корректный результат, обработка запроса пропущена.',
      );
      return null;
    }

    // Проверка на наличие уже существующих данных с такими же координатами и датой
    const existingData = await this.prisma.minecraftData.findFirst({
      where: {
        recordDate: todayString,
        x: x,
        y: y,
        z: z,
      },
    });

    if (existingData) {
      console.log(
        `Запись с датой ${todayString} и координатами (${x}, ${y}, ${z}) уже существует.`,
      );
      return null;
    }

    // Получение UUID продавца
    const UUIDMinecraft: string = await this.neuralService.getMinecraftUUID(
      (await neuralResponse)?.seller ?? 'UNKOWN',
    );

    // Создание записи в БД
    if (
      (await neuralResponse).name === 'UNKOWN' ||
      (await neuralResponse).name === null ||
      (await neuralResponse).quantity === null ||
      (await neuralResponse).price === null ||
      !(await neuralResponse).name ||
      !(await neuralResponse).quantity ||
      !(await neuralResponse).price
    ) {
      console.error('Ответ от нейросервиса не полный');
      return null;
    } else {
      const data: MinecraftDataFull = {
        name: (await neuralResponse).name,
        price: Number((await neuralResponse).price),
        seller: (await neuralResponse).seller ?? 'UNKNOWN',
        sellerUUID: UUIDMinecraft ?? 'UNKNOWN',
        quantity: Number((await neuralResponse).quantity),
        minecraft_id: (await neuralResponse).minecraft_id,
        typeRu: (await neuralResponse).typeRu,
        typeId: (await neuralResponse).typeId,
        x: x,
        y: y,
        z: z,
        recordDate: todayString,
        benefitRation:
          Number((await neuralResponse).quantity) /
          Number((await neuralResponse).price),
      };
      return data;
    }
  }

  // Вспомогательная функция для проверки валидности ответа ИИ
  private isValidResponse(response: MinecraftData | null): boolean {
    return (
      response &&
      response.quantity !== null &&
      response.quantity !== undefined &&
      response.minecraft_id !== 'UNKNOWN' &&
      response.name !== 'UNKNOWN' &&
      !Number.isNaN(Number(response.quantity)) &&
      response.price !== null &&
      response.price !== undefined
    );
  }
  private SliceArray(array: Data[], batchSize: number) {
    const results = [];
    for (let i = 0; i < array.length; i += batchSize) {
      results.push(array.slice(i, i + batchSize));
    }
    return results;
  }
}
