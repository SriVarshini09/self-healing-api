-- Email/password accounts for self-serve sign-up
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
