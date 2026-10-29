-- CreateTable
CREATE TABLE "FailedAuth" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailedAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FailedAuth_createdAt_idx" ON "FailedAuth"("createdAt");
