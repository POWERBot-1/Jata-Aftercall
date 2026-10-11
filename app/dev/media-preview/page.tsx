import { notFound } from "next/navigation";
import { LocalMediaChecks } from "./LocalMediaChecks";
export const dynamic = "force-dynamic";
export const metadata = { title: "Website Studio local raster verification", robots: { index: false, follow: false } };
export default function MediaPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <main><h1>Local raster preparation verification</h1><LocalMediaChecks /></main>;
}
