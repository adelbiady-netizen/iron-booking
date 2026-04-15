import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const restaurant = await prisma.restaurant.upsert({
    where: {
      id: "cmnvm3k0c0000m8oshrbifaqv",
    },
    update: {
      name: "Iron Booking Demo",
      defaultDuration: 90,
    },
    create: {
      id: "cmnvm3k0c0000m8oshrbifaqv",
      name: "Iron Booking Demo",
      defaultDuration: 90,
    },
  });

  await prisma.restaurantTable.createMany({
    data: [
      {
        id: "cmnvwommd0000s4whjhes2az6",
        restaurantId: restaurant.id,
        name: "Table 1",
        capacity: 2,
        isActive: true,
        posX: 40,
        posY: 40,
      },
      {
        id: "cmnvwommd0001s4whxavv3x40",
        restaurantId: restaurant.id,
        name: "Table 2",
        capacity: 4,
        isActive: true,
        posX: 240,
        posY: 40,
      },
      {
        id: "cmnvwommd0002s4wh4gpqeyi9",
        restaurantId: restaurant.id,
        name: "Table 3",
        capacity: 6,
        isActive: true,
        posX: 440,
        posY: 40,
      },
    ],
    skipDuplicates: true,
  });

  console.log("Seed completed successfully.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });