import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
// import { HfInference } from '@huggingface/inference';
import { PrismaClient } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import Together from 'together-ai';

export type MinecraftData = {
  name: string;
  price: number;
  quantity: number;
  seller: string;
  minecraft_id: string;
  typeId: string;
  typeRu: string;
};

export type Items = {
  id?: number;
  items: string;
  x: number;
  y: number;
  z: number;
};

@Injectable()
export class NeuralService {
  private prisma = new PrismaClient();

  constructor(private readonly httpService: HttpService) {}

  async formatDateToString(date: Date): Promise<string> {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  async processData(input: string, apiKey: string): Promise<MinecraftData> {
    const together = new Together({
      apiKey: `${apiKey}`,
    });
    //const client = new HfInfere nce(  `${process.env.HUGGINGFACE_API_TOKEN_FIRST}`,);
    const chatCompletion = await together.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
      messages: [
        {
          role: 'user',
          content: input,
        },
      ],
      max_tokens: 9000,
    });
    //const chatCompletion = await client.chatCompletion({
    //  model: 'mistralai/Mistral-7B-Instruct-v0.3',
    //  messages: [
    //    {
    //      role: 'user',
    //      content: 'What is the capital of France?',
    //    },
    //  ],
    //  provider: 'hf-inference',
    //  max_tokens: 500,
    //});
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
      parsedResponse.name === null ||
      parsedResponse.quantity === null ||
      parsedResponse.price === null
    ) {
      console.error('Ответ от нейросервиса не полный');
      return null;
    }
    return {
      name: parsedResponse.name,
      price: Number(parsedResponse.price),
      seller: parsedResponse.seller ?? 'UNKOWN',
      quantity: parsedResponse.quantity,
      minecraft_id: parsedResponse.minecraft_id,
      typeRu: parsedResponse.typeRu,
      typeId: parsedResponse.typeId,
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
      minecraft_id: item._min.minecraft_id,
      name: item._min.name, // Имя, связанн
      count: item._count.minecraft_id, // К
    }));
  }

  async getBarrelsByFilters(
    minecraft_id?: string,
    seller?: string,
    name?: string,
    orderBy?: any, // Параметр для сортировки
    page: number = 1,
    pageSize: number = 10,
  ) {
    let items: any[];

    if (name) {
      // Устанавливаем порог схожести
      await this.prisma.$queryRaw`SELECT set_limit(0.45);`;

      items = await this.prisma.$queryRaw`
        SELECT *
        FROM "MinecraftData"
        WHERE
          (${minecraft_id}::text IS NULL OR "minecraft_id" = ${minecraft_id}::text)
          AND (${seller}::text IS NULL OR "seller" ILIKE '%' || ${seller}::text || '%')
          AND "name" % ${name}::text
        ORDER BY similarity("name", ${name}::text) DESC, "createdAt" DESC;
      `;
    } else {
      // Если fuzzy-поиск не нужен, применяем обычный фильтр
      const where: any = {};
      if (minecraft_id) where.minecraft_id = minecraft_id;
      if (seller) where.seller = { contains: seller, mode: 'insensitive' };
      if (name) where.name = { contains: name, mode: 'insensitive' };

      items = await this.prisma.minecraftData.findMany({
        where,
        orderBy: [...(orderBy ? [orderBy] : []), { createdAt: 'desc' }],
      });
    }

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

    const groupedArray = Object.values(grouped);

    // Пагинация агрегированного результата
    const start = (page - 1) * pageSize;
    const paginatedBase = groupedArray.slice(start, start + pageSize);

    // Получаем список уникальных координат из сгруппированных данных
    const coordinates = paginatedBase.map((item: Items) => ({
      x: Number(item.x), // Приводим к обычному числу
      y: Number(item.y),
      z: Number(item.z),
      key: `${item.x}_${item.y}_${item.z}`,
    }));

    // Запрашиваем все BarrelItems для выбранных координат одним запросом
    const barrelItemsAll = await this.prisma.barrelItems.findMany({
      where: {
        OR: coordinates.map((coord) => ({
          x: Number(coord.x),
          y: Number(coord.y),
          z: Number(coord.z),
        })),
      },
      orderBy: { createdAt: 'desc' },
    });

    // Группируем BarrelItems по ключу координат
    const barrelItemsGrouped = barrelItemsAll.reduce(
      (acc, item) => {
        const key = `${item.x}_${item.y}_${item.z}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      },
      {} as Record<string, any[]>,
    );

    // Добавляем для каждого элемента MinecraftData массив соответствующих BarrelItems
    const paginated = paginatedBase.map((item: Items) => ({
      ...item,
      barrelItems: barrelItemsGrouped[`${item.x}_${item.y}_${item.z}`] || [],
    }));

    return paginated;
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

  sanitizeText(text: string): string {
    return text.replace(/[^\x00-\x7F\u0400-\u04FF\-_]|[=+\*\/\\]/g, ' ');
  }
}
