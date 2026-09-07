import { Form } from "@remix-run/react";

export const inputClass =
  "mt-1 w-full min-h-11 rounded-xl border border-carbon/15 px-3 focus:border-oliva focus:outline-none";

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-carbon">
        {label}
      </label>
      {children}
    </div>
  );
}

export function MediaGallery({
  images,
  videos,
  removeIntent,
  ownerId,
}: {
  images: string[];
  videos: { url: string; source: string }[];
  removeIntent: string;
  ownerId: string;
}) {
  if (images.length === 0 && videos.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {images.map((url) => (
        <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-xl border border-carbon/10">
          <img src={url} alt="" className="h-full w-full object-cover" />
          <RemoveMediaButton removeIntent={removeIntent} ownerId={ownerId} mediaType="image" value={url} />
        </div>
      ))}
      {videos.map((v) => (
        <div
          key={v.url}
          className="group relative flex h-20 w-32 items-center justify-center overflow-hidden rounded-xl border border-carbon/10 bg-carbon/5 px-2 text-center text-xs text-carbon/60"
        >
          <span className="line-clamp-3">{v.source === "youtube" ? "▶ YouTube" : "▶ Video"}</span>
          <RemoveMediaButton removeIntent={removeIntent} ownerId={ownerId} mediaType="video" value={v.url} />
        </div>
      ))}
    </div>
  );
}

function RemoveMediaButton({
  removeIntent,
  ownerId,
  mediaType,
  value,
}: {
  removeIntent: string;
  ownerId: string;
  mediaType: "image" | "video";
  value: string;
}) {
  return (
    <Form
      method="post"
      className="absolute inset-0 flex items-start justify-end p-1 opacity-0 transition-opacity group-hover:opacity-100"
    >
      <input type="hidden" name="intent" value={removeIntent} />
      <input type="hidden" name="id" value={ownerId} />
      <input type="hidden" name="mediaType" value={mediaType} />
      <input type="hidden" name="value" value={value} />
      <button
        type="submit"
        aria-label="Quitar"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-carbon/80 text-xs font-bold text-hueso"
      >
        ×
      </button>
    </Form>
  );
}

export function AddMediaForm({ ownerId, intent }: { ownerId: string; intent: string }) {
  return (
    <Form
      method="post"
      encType="multipart/form-data"
      className="mt-3 flex flex-col gap-3 rounded-2xl border border-dashed border-carbon/20 p-4 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={ownerId} />
      <Field label="Fotos" htmlFor={`images-${ownerId}`}>
        <input id={`images-${ownerId}`} name="images" type="file" accept="image/*" multiple className={inputClass} />
      </Field>
      <Field label="Video de YouTube" htmlFor={`yt-${ownerId}`}>
        <input id={`yt-${ownerId}`} name="videoYoutubeUrl" type="url" placeholder="https://youtube.com/..." className={inputClass} />
      </Field>
      <Field label="O sube un video" htmlFor={`vf-${ownerId}`}>
        <input id={`vf-${ownerId}`} name="videoFile" type="file" accept="video/*" className={inputClass} />
      </Field>
      <button type="submit" className="min-h-11 shrink-0 rounded-full bg-carbon px-5 text-sm font-bold text-hueso">
        Agregar
      </button>
    </Form>
  );
}
