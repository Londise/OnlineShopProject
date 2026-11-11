import { useEffect, useState } from "react";

// The first visit gets a branded introduction. Later retries keep the page
// usable, and neither a slow banner nor a stalled API can trap the visitor.
export default function useStorefrontLoading({ catalogLoading, catalogError, bannerReady }) {
  const [dismissed, setDismissed] = useState(false);
  const [bannerWaitExpired, setBannerWaitExpired] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    const timer = setTimeout(() => setDismissed(true), 12_000);
    return () => clearTimeout(timer);
  }, [dismissed]);

  useEffect(() => {
    if (dismissed || catalogLoading || catalogError || bannerReady) return;
    const timer = setTimeout(() => setBannerWaitExpired(true), 2500);
    return () => clearTimeout(timer);
  }, [dismissed, catalogLoading, catalogError, bannerReady]);

  const loading = !dismissed && !catalogError &&
    (catalogLoading || (!bannerReady && !bannerWaitExpired));

  useEffect(() => {
    if (!loading) setDismissed(true);
  }, [loading]);

  useEffect(() => {
    if (!loading) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [loading]);

  return loading;
}
