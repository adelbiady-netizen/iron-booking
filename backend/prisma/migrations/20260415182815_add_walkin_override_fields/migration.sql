/*
  Warnings:

  - A unique constraint covering the columns `[restaurantId,name]` on the table `RestaurantTable` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "actualEndTime" TIMESTAMP(3),
ADD COLUMN     "capacityOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overrideApprovedBy" TEXT,
ADD COLUMN     "overrideNote" TEXT,
ADD COLUMN     "reservedSoonOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RestaurantTable" ALTER COLUMN "posX" SET DEFAULT 0,
ALTER COLUMN "posY" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "ServicePeriodConfig" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "period" "ServicePeriod" NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePeriodConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicePeriodConfig_restaurantId_idx" ON "ServicePeriodConfig"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePeriodConfig_restaurantId_period_key" ON "ServicePeriodConfig"("restaurantId", "period");

-- CreateIndex
CREATE INDEX "Reservation_source_idx" ON "Reservation"("source");

-- CreateIndex
CREATE INDEX "Reservation_endTime_idx" ON "Reservation"("endTime");

-- CreateIndex
CREATE INDEX "Reservation_restaurantId_startTime_idx" ON "Reservation"("restaurantId", "startTime");

-- CreateIndex
CREATE INDEX "Reservation_restaurantId_status_startTime_idx" ON "Reservation"("restaurantId", "status", "startTime");

-- CreateIndex
CREATE INDEX "Reservation_restaurantId_tableId_startTime_endTime_idx" ON "Reservation"("restaurantId", "tableId", "startTime", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_restaurantId_name_key" ON "RestaurantTable"("restaurantId", "name");

-- AddForeignKey
ALTER TABLE "ServicePeriodConfig" ADD CONSTRAINT "ServicePeriodConfig_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
