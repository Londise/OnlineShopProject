import { prisma } from '../db/prisma.js';

export const listBanners = async (_req, res) => {
  const now = new Date();
  const banners = await prisma.siteBanner.findMany({ where: { active: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] }, include: { asset: true }, orderBy: { sortOrder: 'asc' } });
  res.json({ banners: banners.map((banner) => ({ id: banner.id, title: banner.title, subtitle: banner.subtitle, linkUrl: banner.linkUrl, imageUrl: banner.asset.url, altText: banner.asset.altText, width: banner.asset.width ?? null, height: banner.asset.height ?? null, sortOrder: banner.sortOrder })) });
};
