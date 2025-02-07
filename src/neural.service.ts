import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { HfInference } from '@huggingface/inference';
import { PrismaClient } from '@prisma/client';
import { firstValueFrom } from 'rxjs';

export type MinecraftData = {
  name: string;
  price: number;
  quantity: number;
  seller: string;
  minecraft_id: string;
  typeId: string;
  typeRu: string;
  coordinates: {
    x: number;
    y: number;
    z: number;
  };
};
@Injectable()
export class NeuralService {
  private prisma = new PrismaClient(); // Переносим объявление внутрь класса

  constructor(private readonly httpService: HttpService) {}

  async formatDateToString(date: Date): Promise<string> {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  async processData(input: string): Promise<MinecraftData> {
    const client = new HfInference(`${process.env.HUGGINGFACE_API_TOKEN}`);
    const chatCompletion = await client.chatCompletion({
      model: 'mistralai/Mistral-7B-Instruct-v0.3',
      messages: [
        {
          role: 'user',
          content: input,
        },
      ],
      max_tokens: 500,
    });
    console.log(chatCompletion.choices[0].message.content);
    if (
      !chatCompletion ||
      !chatCompletion.choices ||
      !chatCompletion.choices[0] ||
      !chatCompletion.choices[0].message ||
      !chatCompletion.choices[0].message.content
    ) {
      console.error(
        'Ответ от нейросервиса пустой или имеет неверную структуру.',
      );
      return null;
    }
    const response = chatCompletion.choices[0].message.content;
    const jsonStart = response.indexOf('{');
    const jsonEnd = response.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1) {
      console.error('JSON-объект не найден в строке');
      return null;
    }

    const jsonString = response.substring(jsonStart, jsonEnd + 1);

    let parsedResponse: MinecraftData;
    try {
      parsedResponse = JSON.parse(jsonString);
    } catch (error) {
      console.error('Ошибка парсинга JSON:', error.message);
      return null;
    }

    if (
      !parsedResponse.quantity ||
      !parsedResponse.price ||
      !parsedResponse.quantity === null ||
      !parsedResponse.price === null
    ) {
      console.error('Ответ от нейросервиса не полный');
      return null;
    }
    return {
      name: parsedResponse.name,
      price: Number(parsedResponse.price),
      seller: parsedResponse.seller,
      quantity: parsedResponse.quantity,
      minecraft_id: parsedResponse.minecraft_id,
      typeRu: parsedResponse.typeRu,
      typeId: parsedResponse.typeId,
      coordinates: parsedResponse.coordinates || { x: null, y: null, z: null },
    };
  }
  async getMinecraftUUID(playerName: string): Promise<string> {
    const url = `https://api.minecraftservices.com/minecraft/profile/lookup/name/${playerName}`;
    try {
      const response = await firstValueFrom(this.httpService.get(url));
      const id = response.data.id;
      return id;
    } catch (error) {
      console.error(`Ошибка при выполнении GET запроса: ${error.message}`);
      return null;
    }
  }
  async getTypes(): Promise<{ type: string; typeId: string; count: number }[]> {
    const typesWithCounts = await this.prisma.minecraftData.groupBy({
      by: ['typeId'], // Группируем только по typeId
      _count: {
        _all: true, // Считаем количество записей
      },
      _min: {
        typeRu: true,
      },
    });

    return typesWithCounts.map((item) => ({
      type: item._min.typeRu, // Берем typeRu из минимального значения
      typeId: item.typeId,
      count: item._count._all, // Количество элементов
    }));
  }

  // Получение предметов по типу
  async getItemsByType(typeId: string) {
    const items = await this.prisma.minecraftData.groupBy({
      by: ['minecraft_id'], // Группируем по typeId
      where: { typeId }, // Фильтруем по переданному typeId
      _count: { minecraft_id: true }, // Считаем количество записей с minecraft_id
      _min: { minecraft_id: true, name: true }, // Берём первое значение minecraft_id и name для каждого typeId
    });

    // Формируем нужную структуру
    return items.map((item) => ({
      minecraft_id: item._min.minecraft_id, // Уникальный minecraft_id
      name: item._min.name, // Имя, связанное с этим minecraft_id
      count: item._count.minecraft_id, // Количество записей с этим typeId
    }));
  }

  async getCardsByFilters(
    minecraft_id?: string,
    seller?: string,
    name?: string,
  ) {
    // Динамически формируем `where` для запроса
    const where: any = {};

    if (minecraft_id) where.minecraft_id = minecraft_id;
    if (seller) where.seller = { contains: seller, mode: 'insensitive' };
    if (name) where.name = { contains: name, mode: 'insensitive' };

    // Запрос к БД
    const items = await this.prisma.minecraftData.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Группировка по координатам (x, y, z)
    const grouped = items.reduce(
      (acc, item) => {
        const key = `${item.x}_${item.y}_${item.z}`;
        if (!acc[key]) {
          acc[key] = { ...item, count: 0 };
        }
        acc[key].count += 1;
        return acc;
      },
      {} as Record<string, any>,
    );

    return Object.values(grouped);
  }

  async getBarrelHistory(x: number, y: number, z: number) {
    const items = await this.prisma.minecraftData.findMany({
      where: { x, y, z }, // Фильтруем по minecraft_id
      orderBy: {
        createdAt: 'desc', // Сортируем так, чтобы ближайшая дата была первой
      },
    });

    const count = await this.prisma.minecraftData.count({
      where: { x, y, z },
    });

    return { items, count }; // Возвращаем историю и количество записей
  }
}
