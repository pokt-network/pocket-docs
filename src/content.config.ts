import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    section: z.string().optional(),
    persona: z.array(z.string()).optional(),
    tabs: z.boolean().optional().default(false),
    status: z.string().optional(),
    lastUpdated: z.string().optional(),
  }),
});

export const collections = { docs };
