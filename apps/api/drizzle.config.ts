import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: '../../packages/schema/src/*.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? '../../data/trip-planner.db',
  },
});
