import prisma from "@/lib/db";

/** New POS photo references must already belong to this business's media library. */
export async function ownsProductImage(businessId: string, url: string): Promise<boolean> {
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url) && !(url.startsWith("/") && !url.startsWith("//"))) return false;
  const asset = await prisma.mediaAsset.findFirst({ where: { businessId, url }, select: { id: true } });
  return Boolean(asset);
}
