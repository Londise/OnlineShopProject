import React, { useState } from "react";
import ResponsiveImage from "./ResponsiveImage";

export default function HeroImage({ onSettled, ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <ResponsiveImage
      {...props}
      className={`hero-slide-media${loaded ? " is-loaded" : ""}`}
      onLoad={() => { setLoaded(true); onSettled(); }}
      onFinalError={() => { setFailed(true); onSettled(); }}
    />
  );
}
