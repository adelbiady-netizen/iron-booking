/*
  Warnings:

  - The values [THIRD_PARTY] on the enum `ReservationSource` will be removed. If these variants are still used in the database, this will fail.
  - The values [ALL_DAY] on the enum `ServicePeriod` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `createdById` on the `Reservation` table. All the data in the column will be lost.
  - You are about to drop the column `departedAt` on the `Reservation` table. All the data in the column will be lost.
  - You are about to drop the column `seatedAt` on the `Reservation` table. All the data in the column will be lost.
  - You are about to drop the column `address` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the column `bufferMin` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the column `lastSeatingMin` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the column `maxFutureDays` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the column `maxPartySize` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the column `slotIntervalMin` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the column `slug` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the column `timezone` on the `Restaurant` table. All the data in the column will be lost.
  - You are about to drop the `Customer` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReservationTable` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ServicePeriodConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SpecialDay` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Staff` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Table` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WaitlistEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WalkIn` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WalkInTable` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Zone` table. If the table is not empty, all the data it contains will be lost.
*/

-- AlterEnum
BEGIN;
CREATE TYPE "ReservationSource_new" AS ENUM ('HOST', 'PHONE', 'ONLINE', 'WALK_IN');
ALTER TABLE "Reservation" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "Reservation" ALTER COLUMN "source" TYPE "ReservationSource_new" USING ("source"::text::"ReservationSource_new");
ALTER TYPE "ReservationSource" RENAME TO "ReservationSource_old";
ALTER TYPE "ReservationSource_new" RENAME TO "ReservationSource";
DROP TYPE "ReservationSource_old";
ALTER TABLE "Reservation" ALTER COLUMN "source" SET DEFAULT 'HOST';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ServicePeriod_new" AS ENUM ('BREAKFAST', 'BRUNCH', 'LUNCH', 'DINNER', 'LATE_NIGHT');
ALTER TABLE "Reservation" ALTER COLUMN "servicePeriod" TYPE "ServicePeriod_new" USING ("servicePeriod"::text::"ServicePeriod_new");
ALTER TYPE "ServicePeriod" RENAME TO "ServicePeriod_old";
ALTER TYPE "ServicePeriod_new" RENAME TO "ServicePeriod";
COMMIT;

-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_customerId_fkey";

-- DropForeignKey
ALTER TABLE "ReservationTable" DROP CONSTRAINT "ReservationTable_reservationId_fkey";

-- DropForeignKey
ALTER TABLE "ReservationTable" DROP CONSTRAINT "ReservationTable_tableId_fkey";

-- DropForeignKey
ALTER TABLE "ServicePeriodConfig" DROP CONSTRAINT "ServicePeriodConfig_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "SpecialDay" DROP CONSTRAINT "SpecialDay_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Staff" DROP CONSTRAINT "Staff_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Table" DROP CONSTRAINT "Table_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Table" DROP CONSTRAINT "Table_zoneId_fkey";

-- DropForeignKey
ALTER TABLE "WaitlistEntry" DROP CONSTRAINT "WaitlistEntry_customerId_fkey";

-- DropForeignKey
ALTER TABLE "WaitlistEntry" DROP CONSTRAINT "WaitlistEntry_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "WalkIn" DROP CONSTRAINT "WalkIn_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "WalkInTable" DROP CONSTRAINT "WalkInTable_tableId_fkey";

-- DropForeignKey
ALTER TABLE "WalkInTable" DROP CONSTRAINT "WalkInTable_walkInId_fkey";

-- DropForeignKey
ALTER TABLE "Zone" DROP CONSTRAINT "Zone_restaurantId_fkey";

-- DropIndex
DROP INDEX "Reservation_confirmationCode_idx";

-- DropIndex
DROP INDEX "Reservation_restaurantId_customerId_idx";

-- DropIndex
DROP INDEX "Reservation_restaurantId_startTime_status_idx";

-- DropIndex
DROP INDEX "Reservation_restaurantId_status_startTime_idx";

-- DropIndex
DROP INDEX "Restaurant_slug_key";

-- AlterTable
ALTER TABLE "Reservation"
DROP COLUMN "createdById",
DROP COLUMN "departedAt",
DROP COLUMN "seatedAt",
ADD COLUMN "tableId" TEXT,
ALTER COLUMN "confirmationCode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Restaurant"
DROP COLUMN "address",
DROP COLUMN "bufferMin",
DROP COLUMN "lastSeatingMin",
DROP COLUMN "maxFutureDays",
DROP COLUMN "maxPartySize",
DROP COLUMN "phone",
DROP COLUMN "slotIntervalMin",
DROP COLUMN "slug",
DROP COLUMN "timezone";

-- DropTable
DROP TABLE "Customer";

-- DropTable
DROP TABLE "ReservationTable";

-- DropTable
DROP TABLE "ServicePeriodConfig";

-- DropTable
DROP TABLE "SpecialDay";

-- DropTable
DROP TABLE "Staff";

-- DropTable
DROP TABLE "Table";

-- DropTable
DROP TABLE "WaitlistEntry";

-- DropTable
DROP TABLE "WalkIn";

-- DropTable
DROP TABLE "WalkInTable";

-- DropTable
DROP TABLE "Zone";

-- עכשיו אפשר למחוק את ה-enum הישן כי כבר אין טבלאות שתלויות בו
DROP TYPE "ServicePeriod_old";

-- DropEnum
DROP TYPE "StaffRole";

-- DropEnum
DROP TYPE "TableShape";

-- DropEnum
DROP TYPE "WaitlistStatus";

-- DropEnum
DROP TYPE "WalkInStatus";

-- DropEnum
DROP TYPE "ZoneType";

-- CreateTable
CREATE TABLE "RestaurantTable" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "posX" INTEGER NOT NULL DEFAULT 40,
    "posY" INTEGER NOT NULL DEFAULT 40,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestaurantTable_restaurantId_idx" ON "RestaurantTable"("restaurantId");

-- CreateIndex
CREATE INDEX "Reservation_restaurantId_idx" ON "Reservation"("restaurantId");

-- CreateIndex
CREATE INDEX "Reservation_tableId_idx" ON "Reservation"("tableId");

-- CreateIndex
CREATE INDEX "Reservation_startTime_idx" ON "Reservation"("startTime");

-- CreateIndex
CREATE INDEX "Reservation_status_idx" ON "Reservation"("status");

-- AddForeignKey
ALTER TABLE "RestaurantTable"
ADD CONSTRAINT "RestaurantTable_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_tableId_fkey"
FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id")
ON DELETE SET NULL ON UPDATE CASCADE;