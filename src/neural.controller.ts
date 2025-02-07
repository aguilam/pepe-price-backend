import pLimit from 'p-limit';

import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { NeuralService } from './neural.service';
import { PrismaClient } from '@prisma/client';
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
@Controller('neural')
export class NeuralController {
  private prisma = new PrismaClient(); // Переносим объявление внутрь класса
  private queue: string[] = [];
  private processing = false;
  private limit = pLimit(6); // ✅ Создаём один экземпляр для всех запросов
  constructor(private readonly neuralService: NeuralService) {}

  @Get('all')
  async getAllMinecraftData() {
    try {
      // Запрос к базе данных для получения всех записей
      const data = await this.prisma.minecraftData.findMany();
      console.log('All data retrieved:', data);
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
  @Get('items')
  async getItemsByType(@Query('type') type: string) {
    return this.neuralService.getItemsByType(type);
  }
  // Получение карточек по minecraft_id
  @Get('barrels')
  async getCardsByFilters(
    @Query('minecraft_id') minecraft_id?: string,
    @Query('seller') seller?: string,
    @Query('name') name?: string,
  ) {
    return this.neuralService.getCardsByFilters(minecraft_id, seller, name);
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
  @Post()
  async handleMinecraftData(@Body() action: string) {
    this.queue.push(action);
    this.startProcessing(); // ✅ Запускаем обработку (если ещё не запущена)
    return { message: 'Запрос поставлен в очередь для обработки' };
  }

  private async startProcessing() {
    if (this.processing) return; // ✅ Если уже обрабатываем - не запускаем повторно
    this.processing = true;

    while (this.queue.length > 0) {
      const tasks = this.queue
        .splice(0, 6)
        .map((action) => this.limit(() => this.processAction(action)));

      await Promise.all(tasks);
    }

    this.processing = false;
  }

  // Функция обработки одного действия
  private async processAction(action: string) {
    const stringAction = JSON.stringify(action);
    console.log(stringAction);
    const input = 'Голубой краситель 2 стака = 3 алм Tandi_ 56 98 -250';
    const json = '```json';
    const actions = `
    Ты — система, которая преобразует входные строки с описанием товара и данными Minecraft в корректный JSON-объект. Строго соблюдай следующие правила:

1. Обязательные поля:
   - **price**: не может быть NULL или UNKNOWN. Должно быть числом. Цена задаётся в виде «алмаз», «алмазика», «алм» или «алмазный блок». Если указан «алмазный блок», учитывай, что 1 блок = 9 алмазов. «Алмазный блок» может быть написан как «АБ», «Абс», «Алм. блок, {количество блоков}АБ», «аб», «{количество блоков}аб». Если там есть цифра, но точно не указана как например алмазы, например {"x":6,"y":2,"z":78,"text":"Незерит 23 Улучшение 9  agusev2311"}, тут ты должен записать name:Незерит price:23
   - **quantity**: не может быть NULL или UNKNOWN, должно быть числом. Количество всегда указывай в штуках(могут быть написаны как шт, штучек, штук, штучк.). Если указаны стаки(могут быть написаны как стаки, ст, слот, стак), помни, что 1 стак = 64 штуки. При наличии комбинаций суммируй общее количество в штуках.
   - **name**: может быть NULL или UNKNOWN, только, если там точно отсутствуют нужные данные! В таком случае пиши UNKNOWN. Должно быть на русском (кириллица). Убирай лишние символы и эмодзи.
   - **minecraft_id**: не может быть NULL или UNKNOWN. Содержит только идентификатор предмета из Minecraft (например, для «полностью чаренной на удачу и шёлк алмазной кирки» укажи "diamond_pickaxe").
   - **typeRu**: значение должно быть одним из следующих (на русском): «еда», «разное», «ценности», «блоки», «книги», «броня и оружие». Если товар не подходит ни к одной категории, используй «разное». Кроме этих 6 категорий нету, используй только их
   - **typeId**: соответствующий перевод typeRu на английский (строчными буквами): «eat», «other», «valuables», «blocks», «books», «armors».
   - **seller**: имя продавца. Если не указано, заполни значением "None".
   - **coordinates**: объект с полями x, y, z – числовыми значениями.

2. Вывод должен быть ТОЛЬКО корректным JSON-объектом без лишних символов, комментариев или обрамляющих конструкций.
   • Не добавляй лишних пробелов, переносов строк или символов.
   • Не используй обрамляющие конструкции (например, «${json}»).
   • Не добавляй какие то свои комменатрии вообще забудь о такой конструкции как комментарии
   • Убедись, что в итоговом JSON нет ошибок синтаксиса: все свойства должны корректно разделяться запятыми, и не должно быть лишних запятых в конце объектов.

3. Все числовые данные (price, quantity, координаты) выводи как числа (без кавычек).

4. Перед выводом результата обязательно проверь валидность JSON.
    Пример 1:
Вход: Блок кварца 1 стак = 1 алм Tandi_ 56 98 -250
Результат: {
  "name": "Блоки кварца",
  "quantity": "64",
  "price": "1",
  "seller": "Tandi_",
  "minecraft_id": "quartz_block",
  "typeRu": " Блоки",
  "typeId": "blocks",
  "coordinates": {
    "x": 56,
    "y": 98,
    "z": -250
  }
}

Пример 2:
Вход: = Гравий = 64 шт - 1 ал Folmors =-=-=-=-=- 15 15 15
Результат: {
  "name": "Гравий",
  "quantity": "64",
  "price": "1",
  "seller": "Folmors",
  "minecraft_id": "gravel",
  "typeRu": " Блоки",
  "typeId": "blocks",
  "coordinates": {
    "x": 15,
    "y": 15,
    "z": 15
  }
}
  Пример 3:
Вход: ДИПСЛЕЙТ 2 СТАКА 1 АЛМАЗ  123 60 -140
Результат: {
  "name": "Дипслейт",
  "quantity": "128",
  "price": "1",
  "seller": "None",
  "minecraft_id": "deepslate",
  "typeRu": " Блоки",
  "typeId": "blocks",
  "coordinates": {
    "x": 123,
    "y": 60,
    "z": -140
  }
}
  Пример 4:
Вход: Шаблон око Слот 20 аб Wahoop 123 -445 900
Результат: {
  "name": "Шаблон око",
  "quantity": "1 ",
  "price": "180",
  "seller": "Wahoop",
  "minecraft_id": "eye_armor_trim_smithing_template",
  "typeRu": " Разное",
  "typeId": "other",
  "coordinates": {
    "x": 123,
    "y": -445,
    "z": 900
  }
}
  Пример 5:
Вход: НЕЗЕРИТ 1 слит. - 22 алм. блоков /////// metraska -23 55 -117
Результат: {
  "name": "Незерит",
  "quantity": "1 ",
  "price": "198",
  "seller": "metraska",
  "minecraft_id": "netherite_ingot",
  "typeRu": " Ценности",
  "typeId": "valuables",
  "coordinates": {
    "x": -23,
    "y": 55,
    "z": -117
  }
}
    Пример 6:
Вход: КаМеНь 1/1/1/1/1 2 стака - 1 алмазный блок Kerel -13 35 -217
Результат: {
  "name": "Камень",
  "quantity": "128 ",
  "price": " 9",
  "seller": "Kerel",
  "minecraft_id": "stone",
  "typeRu": " Блоки",
  "typeId": "blocks",
  "coordinates": {
    "x": -13,
    "y": 35,
    "z": -217
  }
}

    Пример 7:
Вход: 😀Каменные кирпичи😀😊 3 стака и 128 штук - 3 алм блока Kerl -10 24 -150
Результат: {
  "name": "Каменный кирпич",
  "quantity": "320 ",
  "price": " 24",
  "seller": "Kerl",
  "minecraft_id": "stonebrick",
  "typeRu": " Блоки",
  "typeId": "blocks",
  "coordinates": {
    "x": -10,
    "y": 24,
    "z": -150
  }
}
    Пример 8:
Вход: 😀Кирпичи😊 1 стак и 64 штуки - 3 алм Aguilam -10 30 -150
Результат: {
  "name": "Кирпичи",
  "quantity": "128",
  "price": " 3",
  "seller": "Aguilam",
  "minecraft_id": "brick",
  "typeRu": " Блоки",
  "typeId": "blocks",
  "coordinates": {
    "x": -10,
    "y": 30,
    "z": -150
  }
}
      Пример 9:
Вход: Золотая 🌶МОРКОВКА🌶 32 штуки - 2 алмаз. Jkey -15 35 -160
Результат: {
  "name": "Золотая морковь",
  "quantity": "32",
  "price": " 2",
  "seller": "Jkey",
  "minecraft_id": "golden_carrot",
  "typeRu": "Еда",
  "typeId": "eat",
  "coordinates": {
    "x": -15,
    "y": 35,
    "z": -160
  }
}

      Пример 10:
Вход: Лучшая фулл чаренная алмазная кирка 30 лвл 1 штука - 10 алмаз Jerkey -20 40 -167
Результат: {
  "name": "Алмазная кирка",
  "quantity": "1",
  "price": " 10",
  "seller": "Jerkey",
  "minecraft_id": "diamond_pickaxe",
  "typeRu": "Броня и оружие",
  "typeId": "armors",
  "coordinates": {
    "x": -20,
    "y": 40,
    "z": -167
  }
}

      Пример 11:
Вход: Починка 1 штука - 9 алмаз Jerkey -20 40 -167
Результат: {
  "name": "Починка",
  "quantity": "1",
  "price": " 9",
  "seller": "Jerkey",
  "minecraft_id": "enchanted_book",
  "typeRu": "Книги",
  "typeId": "books",
  "coordinates": {
    "x": -20,
    "y": 40,
    "z": -167
  }
}

      Пример 12:
Вход: Книга 1984 1 штука - 5 алмаз Jeffry -25 45 -167
Результат: {
  "name": "Книга 1984",
  "quantity": "1",
  "price": " 5",
  "seller": "Jeffry",
  "minecraft_id": "book",
  "typeRu": "Книги",
  "typeId": "books",
  "coordinates": {
    "x": -25,
    "y": 45,
    "z": -167
  }
}

      Пример 13:
Вход: Голубой краситель 2 стака = 3 алм Tandi_ 56 98 -250
Результат: {
  "name": "Голубой краситель",
  "quantity": "128",
  "price": " 3",
  "seller": "Tandi_",
  "minecraft_id": "blue_dye",
  "typeRu": "Другое",
  "typeId": "other",
  "coordinates": {
    "x": 56,
    "y": 98,
    "z": -250
  }
}

      Пример 14:
Вход: Вкусный тортик 1 штука - 2 алмаз Jeffery -25 45 -167
Результат: {
  "name": "Торт",
  "quantity": "1",
  "price": "5",
  "seller": "Jeffery",
  "minecraft_id": "cake",
  "typeRu": "еда",
  "typeId": "eat",
  "coordinates": {
    "x": -25,
    "y": 45,
    "z": -167
  }
}
        Пример 15:
Вход: Злая бутылка 1 сила - 2 алм 4 сила - 4 алм Jeffery -25 45 -167
Результат: {
  "name": "Злая бутылка 1 сила",
  "quantity": "1",
  "price": "2",
  "seller": "Jeffery",
  "minecraft_id": "ominous_bottle",
  "typeRu": "другое",
  "typeId": "other",
  "coordinates": {
    "x": -25,
    "y": 45,
    "z": -167
  }
}
          Пример 16:
Вход: Packed ГрязьDW -------------- Стак 2/алм  K0zochka -35 43 -167
Результат: {
  "name": "Грязь",
  "quantity": "128",
  "price": "1",
  "seller": "K0zochka",
  "minecraft_id": "ominous_bottle",
  "typeRu": "Блоки",
  "typeId": "blocks",
  "coordinates": {
    "x": -35,
    "y": 43,
    "z": -167
  }
}


После описания примеров обработай входные данные и выведи результат ТОЛЬКО в формате корректного JSON.

Вход: ${stringAction}
Результат:
`;
    const todayString = await this.neuralService.formatDateToString(new Date());
    const neuralResponse: MinecraftData | null =
      await this.neuralService.processData(actions);

    if (
      !neuralResponse ||
      !neuralResponse.coordinates ||
      neuralResponse.quantity === null ||
      neuralResponse.quantity === undefined ||
      neuralResponse.minecraft_id === 'UNKNOWN' ||
      neuralResponse.name === 'UNKNOWN' ||
      Number.isNaN(Number(neuralResponse.quantity)) ||
      neuralResponse.price === null ||
      neuralResponse.price === undefined ||
      neuralResponse.coordinates.x === null ||
      neuralResponse.coordinates.x === undefined ||
      neuralResponse.coordinates.y === null ||
      neuralResponse.coordinates.y === undefined ||
      neuralResponse.coordinates.z === null ||
      neuralResponse.coordinates.z === undefined
    ) {
      console.warn(
        'Нейросервис не вернул корректный результат, обработка запроса пропущена.',
      );
      return null;
    }

    const existingData = await this.prisma.minecraftData.findFirst({
      where: {
        recordDate: todayString,
        x: neuralResponse.coordinates.x,
        y: neuralResponse.coordinates.y,
        z: neuralResponse.coordinates.z,
      },
    });

    if (existingData) {
      console.log(
        `Запись с датой ${todayString} и такими координатами уже существует.`,
      );
      return null;
    }

    const UUIDMinecraft: string = await this.neuralService.getMinecraftUUID(
      neuralResponse.seller,
    );

    const data = await this.prisma.minecraftData.create({
      data: {
        name: neuralResponse.name,
        price: Number(neuralResponse.price),
        seller: neuralResponse.seller ?? 'UNKNOWN',
        sellerUUID: UUIDMinecraft ?? 'UNKNOWN',
        quantity: Number(neuralResponse.quantity),
        minecraft_id: neuralResponse.minecraft_id,
        typeRu: neuralResponse.typeRu,
        typeId: neuralResponse.typeId,
        x: neuralResponse.coordinates.x,
        y: neuralResponse.coordinates.y,
        z: neuralResponse.coordinates.z,
        recordDate: todayString,
      },
    });

    console.log(data);
    return `Готово: ${action}`;
  }
}
