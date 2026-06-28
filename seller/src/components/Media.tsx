import { useEffect, useRef, useState } from "react";
import { SignedIn, SignedOut, AuthLoading } from "@neondatabase/auth-ui";
import Uppy from "@uppy/core";
import XHRUpload from "@uppy/xhr-upload";
import UppyDashboard from "@uppy/react/dashboard";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import { AuthProvider } from "./AuthProvider";
import { AppHeader } from "./AppHeader";
import { callWorker, getToken, workerUrl } from "../lib/auth";

type Image = { key: string; url: string; uploaded_at: string };

// The Media page (/media) — a top-level peer of Orders. Behind sign-in; a
// signed-out visitor is bounced to the dashboard (which shows the sign-in form).
export default function Media() {
  return (
    <AuthProvider>
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-3 py-6 sm:px-6">
        <AuthLoading>
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </AuthLoading>
        <SignedOut>
          <RedirectHome />
        </SignedOut>
        <SignedIn>
          <div className="flex flex-col gap-4">
            <AppHeader current="media" />
            <Uploader />
          </div>
        </SignedIn>
      </main>
    </AuthProvider>
  );
}

function RedirectHome() {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return (
    <p className="text-center text-sm text-muted-foreground">Redirecting…</p>
  );
}

// Uppy gives the upload UX (drag-drop, the native picker — which is the camera
// on mobile — progress, previews, type/size limits) for free. It POSTs each
// image straight to the Worker (XHRUpload, raw body so the Worker content-hashes
// it), authed with the seller's Neon Auth token. Below the uploader we render
// the shop's whole gallery, loaded from GET /seller/media; a freshly uploaded
// image is prepended so it shows without a round-trip. Delete is the next ticket.
function Uploader() {
  // The shop's gallery, newest first. Loaded on mount; an upload prepends.
  const [images, setImages] = useState<Image[]>([]);
  // XHRUpload's headers callback is synchronous, but the Neon Auth token is
  // async — so keep the latest token in a ref and read it when each request is
  // built. Refreshed on mount and whenever a file is added, well before the user
  // clicks Upload.
  const tokenRef = useRef("");
  const [uppy] = useState(() =>
    new Uppy({
      restrictions: {
        allowedFileTypes: ["image/png", "image/jpeg", "image/webp"],
        maxFileSize: 10 * 1024 * 1024,
      },
    }).use(XHRUpload, {
      endpoint: `${workerUrl}/seller/media`,
      method: "POST",
      // Raw file body (not multipart) so the Worker reads the bytes directly and
      // content-hashes them; the token + the file's content-type ride as headers.
      formData: false,
      headers: (file) => ({
        authorization: `Bearer ${tokenRef.current}`,
        "content-type": file.type,
      }),
    }),
  );

  useEffect(() => {
    let active = true;
    const refresh = () =>
      getToken().then((t) => {
        if (active) tokenRef.current = t ?? "";
      });
    void refresh();
    const onAdded = () => void refresh();
    const onSuccess = (_file: unknown, response: { body?: unknown }) => {
      const img = response.body as Image | undefined;
      if (img?.key)
        setImages((prev) =>
          prev.some((p) => p.key === img.key) ? prev : [img, ...prev],
        );
    };
    uppy.on("file-added", onAdded);
    uppy.on("upload-success", onSuccess);
    return () => {
      active = false;
      uppy.off("file-added", onAdded);
      uppy.off("upload-success", onSuccess);
    };
  }, [uppy]);

  // Load the existing gallery once the seller lands on the tab.
  useEffect(() => {
    let active = true;
    void callWorker("/seller/media")
      .then((r) => (r.ok ? r.json() : { images: [] }))
      .then((d: { images: Image[] }) => {
        if (active) setImages(d.images);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <UppyDashboard
        uppy={uppy}
        height={320}
        width="100%"
        note="PNG, JPG or WebP, up to 10MB"
        proudlyDisplayPoweredByUppy={false}
        theme="auto"
      />
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img) => (
            <img
              key={img.key}
              src={img.url}
              alt=""
              className="aspect-square w-full rounded-md border border-border object-cover"
            />
          ))}
        </div>
      )}
    </div>
  );
}
