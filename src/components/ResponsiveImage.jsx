import React, { useState } from "react";
import { getImageSrcSet, getImageVariant } from "../config/media";

export default function ResponsiveImage({
  src,
  sourceWidth,
  sourceHeight,
  variantWidth = 800,
  widths,
  sizes,
  alt,
  onError,
  ...props
}) {
  const [failedSource, setFailedSource] = useState(null);
  const useOriginal = failedSource === src;
  const optimizedSource = useOriginal ? src : getImageVariant(src, {
    width: variantWidth,
    sourceWidth,
    sourceHeight,
  });
  const srcSet = useOriginal ? "" : getImageSrcSet(src, {
    widths,
    sourceWidth,
    sourceHeight,
  });

  const handleError = event => {
    if (!useOriginal && (optimizedSource !== src || srcSet)) setFailedSource(src);
    onError?.(event);
  };

  return (
    <img
      {...props}
      src={optimizedSource}
      srcSet={srcSet || undefined}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      onError={handleError}
    />
  );
}
