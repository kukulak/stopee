import { uploadedFileToPublicUrl } from "~/lib/upload.server";

export function collectMediaFromForm(formData: FormData) {
  const images = formData
    .getAll("images")
    .map((f) => uploadedFileToPublicUrl(f as File))
    .filter((url): url is string => Boolean(url));

  const videos: { url: string; source: "youtube" | "upload" }[] = [];
  const youtubeUrl = String(formData.get("videoYoutubeUrl") ?? "").trim();
  if (youtubeUrl) videos.push({ url: youtubeUrl, source: "youtube" });
  const videoFileUrl = uploadedFileToPublicUrl(formData.get("videoFile") as File | null);
  if (videoFileUrl) videos.push({ url: videoFileUrl, source: "upload" });

  return { images, videos };
}
