"use client";
import * as React from "react";
import { MAC_RATIO, MAC_TITLE_BAR, PHONE_SCREEN } from "@/lib/constants";
import { bezelGeometry, isDuoDevice, type DuoDevice } from "@/lib/frame-assets";
import type { Device, IphoneFrameStyle } from "@/lib/types";
import { img, imgSize } from "@/lib/image-cache";

type FrameProps = {
  src: string;
  alt?: string;
  style?: React.CSSProperties;
  /** When true, hide EmptySlot placeholder (so it doesn't bake into exports). */
  hideEmpty?: boolean;
  /** iPhone hardware frame variant ("auto" avoids Dynamic Island overlap per screenshot). */
  frameStyle?: IphoneFrameStyle;
};

type ResolvedIphoneStyle = Exclude<IphoneFrameStyle, "auto">;
const smartFrameCache = new Map<string, "dynamic-island" | "minimal-clean">();

function analyzeIphoneFrameForSrc(src: string, rawSrc: string): Promise<"dynamic-island" | "minimal-clean"> {
  if (!src) return Promise.resolve("minimal-clean");
  const cacheKey = `${rawSrc}::${src.slice(0, 64)}:${src.length}`;
  const hit = smartFrameCache.get(cacheKey);
  if (hit) return Promise.resolve(hit);

  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const W = 45;
        const H = 98;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve("minimal-clean");
          return;
        }
        ctx.drawImage(image, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);

        // Sample top corners (avoiding 9:41 left ear & icons right ear) for background tone
        const corners = [
          [1, 0], [2, 0], [3, 0], [41, 0], [42, 0], [43, 0],
          [1, 2], [43, 2],
        ];
        let bgR = 0, bgG = 0, bgB = 0;
        for (const [cx, cy] of corners) {
          const idx = (cy * W + cx) * 4;
          bgR += data[idx];
          bgG += data[idx + 1];
          bgB += data[idx + 2];
        }
        bgR /= corners.length;
        bgG /= corners.length;
        bgB /= corners.length;

        const diff = (x: number, y: number) => {
          const idx = (y * W + x) * 4;
          return (
            Math.abs(data[idx] - bgR) > 22 ||
            Math.abs(data[idx + 1] - bgG) > 22 ||
            Math.abs(data[idx + 2] - bgB) > 22
          );
        };

        // 1. Dynamic Island pill collision zone (x: 33%..66%, y: 1.0%..6.2%)
        let islandHits = 0;
        for (let y = 1; y <= 6; y++) {
          for (let x = 15; x <= 29; x++) {
            if (diff(x, y)) islandHits++;
          }
        }

        // 2. Top-bar / edge-to-edge UI immediately below island (y: ~6%)
        let tightHeaderHits = 0;
        for (let x = 13; x <= 31; x++) {
          if (diff(x, 6)) tightHeaderHits++;
        }

        const chosen: "dynamic-island" | "minimal-clean" =
          islandHits >= 2 || tightHeaderHits >= 5 ? "minimal-clean" : "dynamic-island";
        smartFrameCache.set(cacheKey, chosen);
        resolve(chosen);
      } catch {
        resolve("minimal-clean");
      }
    };
    image.onerror = () => resolve("minimal-clean");
    image.src = src;
  });
}

function useResolvedIphoneStyle(
  isIphoneTarget: boolean,
  resolvedSrc: string,
  rawSrc: string,
  requestedStyle?: IphoneFrameStyle,
): ResolvedIphoneStyle {
  const [autoChoice, setAutoChoice] = React.useState<"dynamic-island" | "minimal-clean">("minimal-clean");

  React.useEffect(() => {
    if (!isIphoneTarget) return;
    if (requestedStyle && requestedStyle !== "auto") return;
    let active = true;
    analyzeIphoneFrameForSrc(resolvedSrc, rawSrc).then((choice) => {
      if (active) setAutoChoice(choice);
    });
    return () => {
      active = false;
    };
  }, [isIphoneTarget, resolvedSrc, rawSrc, requestedStyle]);

  if (!isIphoneTarget) return "dynamic-island";
  if (requestedStyle && requestedStyle !== "auto") return requestedStyle;
  return autoChoice;
}

/**
 * Clean Apple-compliant iOS Status Bar (9:41, Cellular, Wi-Fi, Battery)
 * Displayed on iPhone frames when hosting Android or cross-platform captures
 * to prevent App Store review rejection under Guideline 2.3.3.
 */
export function IosStatusBarOverlay({ color }: { color?: string }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: '1.2%',
        left: '5%',
        right: '5%',
        height: '3.2%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        color: color || '#ffffff',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif",
        fontWeight: 600,
        fontSize: '2.8cqw',
        zIndex: 25,
        pointerEvents: 'none',
        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
      }}
    >
      <span style={{ letterSpacing: '-0.01em' }}>9:41</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.2cqw' }}>
        {/* Cell signal (4 bars) */}
        <svg width="1.2em" height="0.8em" viewBox="0 0 17 10" fill="currentColor" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
          <rect x="0" y="7.5" width="2.5" height="2.5" rx="0.5" />
          <rect x="4.5" y="5" width="2.5" height="5" rx="0.5" />
          <rect x="9" y="2.5" width="2.5" height="7.5" rx="0.5" />
          <rect x="13.5" y="0" width="2.5" height="10" rx="0.5" />
        </svg>
        {/* Wi-Fi */}
        <svg width="1.2em" height="0.85em" viewBox="0 0 16 12" fill="currentColor" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
          <path d="M8 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm-3.8-4.2a5.4 5.4 0 0 1 7.6 0 .9.9 0 0 0 1.2-1.2 7.2 7.2 0 0 0-10 0 .9.9 0 1 0 1.2 1.2zm-3-3a9.6 9.6 0 0 1 13.6 0 .9.9 0 0 0 1.2-1.3 11.4 11.4 0 0 0-16 0 .9.9 0 1 0 1.2 1.3z" />
        </svg>
        {/* Battery */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: '1.6em', height: '0.82em', border: '1px solid currentColor', borderRadius: '0.22em', padding: '1px', boxSizing: 'border-box' }}>
            <div style={{ width: '100%', height: '100%', background: 'currentColor', borderRadius: '0.12em' }} />
          </div>
          <div style={{ width: '1.5px', height: '0.35em', background: 'currentColor', borderRadius: '0 1px 1px 0' }} />
        </div>
      </div>
    </div>
  );
}

// iPhone — uses pre-measured mockup.png overlay
export function Phone({ src, alt = "", style, hideEmpty }: FrameProps) {
  const resolved = img(src);
  // Auto-detect if source is an Android capture needing system bar crop
  const isPreCroppedIos = src.includes("-ios");
  const isAndroidSource = src.includes("-android") || src.includes("android") || (!isPreCroppedIos && !src.includes("apple") && !src.includes("iphone"));

  return (
    <div style={{ position: "relative", aspectRatio: "1022 / 2082", ...style }}>
      <img
        src={img("/mockup.png")}
        alt=""
        data-export-check="full"
        style={{ display: "block", width: "100%", height: "100%" }}
        draggable={false}
      />
      <div
        style={{
          position: "absolute",
          zIndex: 10,
          overflow: "hidden",
          left: `${PHONE_SCREEN.L}%`,
          top: `${PHONE_SCREEN.T}%`,
          width: `${PHONE_SCREEN.W}%`,
          height: `${PHONE_SCREEN.H}%`,
          borderRadius: `${PHONE_SCREEN.RX}% / ${PHONE_SCREEN.RY}%`,
          background: "#111",
          containerType: "size",
        }}
      >
        {resolved ? (
          <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
            <img
              src={resolved}
              alt={alt}
              style={
                !isPreCroppedIos && isAndroidSource
                  ? {
                      display: "block",
                      width: "100%",
                      height: "104%",
                      marginTop: "-4%",
                      objectFit: "cover",
                    }
                  : {
                      display: "block",
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: "top",
                    }
              }
              draggable={false}
            />
            {/* Clean Apple-standard status bar overlay (only when raw uncropped Android capture is used) */}
            {!isPreCroppedIos && isAndroidSource && <IosStatusBarOverlay />}
          </div>
        ) : hideEmpty ? null : (
          <EmptySlot />
        )}
      </div>
    </div>
  );
}

export function AndroidPhone({ src, alt = "", style, hideEmpty }: FrameProps) {
  const resolved = img(src);
  // Detect if an iOS capture is placed inside an Android frame, requiring notch/home bar crop
  const isIosSource = src.includes("-ios") || src.includes("iphone") || src.includes("apple");

  return (
    <div style={{ position: "relative", aspectRatio: "9 / 19.5", ...style }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "8% / 4%",
          background: "linear-gradient(160deg, #2a2a2e 0%, #18181b 100%)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), 0 8px 40px rgba(0,0,0,0.55)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "1.5%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "3%",
            height: "1.4%",
            borderRadius: "50%",
            background: "#0d0d0f",
            border: "1px solid rgba(255,255,255,0.06)",
            zIndex: 20,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "3.5%",
            top: "2%",
            width: "93%",
            height: "96%",
            borderRadius: "5.5% / 2.6%",
            overflow: "hidden",
            background: "#000",
            containerType: "size",
          }}
        >
          {resolved ? (
            <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
              <img
                src={resolved}
                alt={alt}
                style={
                  isIosSource
                    ? {
                        display: "block",
                        width: "100%",
                        height: "108.5%",
                        marginTop: "-5%",
                        objectFit: "cover",
                      }
                    : {
                        display: "block",
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        objectPosition: "top",
                      }
                }
                draggable={false}
              />
            </div>
          ) : hideEmpty ? null : (
            <EmptySlot />
          )}
        </div>
      </div>
    </div>
  );
}

export function AndroidTabletP({ src, alt = "", style, hideEmpty }: FrameProps) {
  const resolved = img(src);
  return (
    <div style={{ position: "relative", aspectRatio: "5 / 8", ...style }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "4.5% / 2.8%",
          background: "linear-gradient(160deg, #2a2a2e 0%, #18181b 100%)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), 0 8px 48px rgba(0,0,0,0.6)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "1.2%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "1.4%",
            height: "0.88%",
            borderRadius: "50%",
            background: "#0d0d0f",
            zIndex: 20,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "3.5%",
            top: "2.2%",
            width: "93%",
            height: "95.6%",
            borderRadius: "2.5% / 1.6%",
            overflow: "hidden",
            background: "#000",
          }}
        >
          {resolved ? (
            <img
              src={resolved}
              alt={alt}
              style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              draggable={false}
            />
          ) : hideEmpty ? null : (
            <EmptySlot />
          )}
        </div>
      </div>
    </div>
  );
}

export function AndroidTabletL({ src, alt = "", style, hideEmpty }: FrameProps) {
  const resolved = img(src);
  return (
    <div style={{ position: "relative", aspectRatio: "8 / 5", ...style }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "2.8% / 4.5%",
          background: "linear-gradient(160deg, #2a2a2e 0%, #18181b 100%)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), 0 8px 48px rgba(0,0,0,0.6)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "1.2%",
            top: "50%",
            transform: "translateY(-50%)",
            width: "0.88%",
            height: "1.4%",
            borderRadius: "50%",
            background: "#0d0d0f",
            zIndex: 20,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "2.2%",
            top: "3.5%",
            width: "95.6%",
            height: "93%",
            borderRadius: "1.6% / 2.5%",
            overflow: "hidden",
            background: "#000",
          }}
        >
          {resolved ? (
            <img
              src={resolved}
              alt={alt}
              style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              draggable={false}
            />
          ) : hideEmpty ? null : (
            <EmptySlot />
          )}
        </div>
      </div>
    </div>
  );
}

// Mac window: title bar + a content area that is exactly 16:10, the Mac App
// Store's own aspect, so a full-screen or 16:10 capture fills it uncropped.
export function MacWindow({ src, alt = "", style, hideEmpty }: FrameProps) {
  const resolved = img(src);
  const titleBar = `${(MAC_TITLE_BAR / (1 + MAC_TITLE_BAR)) * 100}%`;
  const light = (color: string) => (
    <span
      style={{
        width: "1.1%",
        aspectRatio: "1",
        borderRadius: "50%",
        background: color,
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)",
        flexShrink: 0,
      }}
    />
  );
  return (
    <div style={{ position: "relative", aspectRatio: `${MAC_RATIO}`, ...style }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          // Circular corners: the vertical radius is scaled by the frame aspect.
          borderRadius: `1.1% / ${1.1 * MAC_RATIO}%`,
          background: "#1C1C1E",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12), 0 18px 60px rgba(0,0,0,0.40)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            height: titleBar,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: "0.75%",
            padding: "0 1.3%",
            background: "linear-gradient(180deg, #3D3D40 0%, #323235 100%)",
            boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.35)",
            flexShrink: 0,
          }}
        >
          {light("#FF5F57")}
          {light("#FEBC2E")}
          {light("#28C840")}
        </div>
        <div style={{ flex: 1, overflow: "hidden", background: "#111", minHeight: 0 }}>
          {resolved ? (
            <img
              src={resolved}
              alt={alt}
              style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              draggable={false}
            />
          ) : hideEmpty ? null : (
            <EmptySlot />
          )}
        </div>
      </div>
    </div>
  );
}

export function IPad({ src, alt = "", style, hideEmpty }: FrameProps) {
  const resolved = img(src);
  return (
    <div style={{ position: "relative", aspectRatio: "770 / 1000", ...style }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "5% / 3.6%",
          background: "linear-gradient(180deg, #2C2C2E 0%, #1C1C1E 100%)",
          position: "relative",
          overflow: "hidden",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1), 0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "1.2%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "0.9%",
            height: "0.65%",
            borderRadius: "50%",
            background: "#111113",
            zIndex: 20,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "4%",
            top: "2.8%",
            width: "92%",
            height: "94.4%",
            borderRadius: "2.2% / 1.6%",
            overflow: "hidden",
            background: "#000",
          }}
        >
          {resolved ? (
            <img
              src={resolved}
              alt={alt}
              style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              draggable={false}
            />
          ) : hideEmpty ? null : (
            <EmptySlot />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- iPhone Duo ----------
// Geometry comes from Apple's bezel in public/frames/ (measured by
// /api/frames) or, without one, a drawn frame whose screen has the capture's
// exact aspect. The frame fits itself inside whatever box it is given, so a
// placement saved with a different bezel never stretches it.

// A capture whose aspect is off by more than this is letterboxed rather than
// cropped: cropping would cut real UI, which is worse than a visible bar.
// Loose enough for every size a device accepts: Apple Watch slots differ from
// the Ultra's 422 × 514 screen by up to 2.6 %.
const FIT_TOLERANCE = 0.03;
const PHONE_FIT_TOLERANCE = 0.08;
// The two iPhone Duo displays differ by only 2.35 % (1398 × 2034 against
// 2007 × 2853), so Duo captures must match far more closely to tell an outer
// capture from an inner one. Scaled-down captures of the right display pass.
export const DUO_FIT_TOLERANCE = 0.005;

export function captureFits(src: string, screenAspect: number, tolerance = FIT_TOLERANCE) {
  const size = imgSize(src);
  return !size || Math.abs(size.w / size.h / screenAspect - 1) <= tolerance;
}

// A device drawn under Apple's bezel (or, for iPhone Duo without one, a drawn
// stand-in). Mac captures are 16:10 but MacBook screens are a little taller, so
// a Mac capture fills the screen from the top and loses a sliver at the bottom,
// like the built-in Mac window; everything else is letterboxed if it doesn't fit.
function BezelFrame({ device, src, alt = "", style, hideEmpty, frameStyle }: FrameProps & { device: Device }) {
  const g = bezelGeometry(device);
  if (!g) return null;
  const resolved = img(src);
  const isIphoneTarget = device === "iphone" || device.startsWith("creative-");
  const activeStyle = useResolvedIphoneStyle(isIphoneTarget, resolved, src, frameStyle);
  const useAppleBezelImage = !!g.image && (!isIphoneTarget || activeStyle === "dynamic-island");
  const frameRadius = `${(g.radius.x * g.screen.W) / 100 + g.screen.L}% / ${(g.radius.y * g.screen.H) / 100 + g.screen.T}%`;
  const chassisTheme =
    activeStyle === "sleek-silver"
      ? {
          bg: "linear-gradient(155deg, #f3f4f6 0%, #c5cad3 48%, #e5e7eb 100%)",
          shadow: "inset 0 0 0 1.5px rgba(255,255,255,0.85), inset 0 0 0 4px #18181b, 0 10px 40px rgba(0,0,0,0.32)",
          innerLip: "#0e0e11",
          speaker: "#27272a",
        }
      : activeStyle === "clay-matte"
        ? {
            bg: "linear-gradient(160deg, #fafaf9 0%, #e7e5e4 55%, #d6d3d1 100%)",
            shadow: "inset 0 0 0 1.5px rgba(255,255,255,0.9), inset 0 0 0 4px rgba(0,0,0,0.08), 0 12px 42px rgba(0,0,0,0.22)",
            innerLip: "#d6d3d1",
            speaker: "rgba(0,0,0,0.22)",
          }
        : {
            bg: "linear-gradient(155deg, #2d2e33 0%, #141518 45%, #232429 100%)",
            shadow: "inset 0 0 0 1.5px rgba(255,255,255,0.20), inset 0 0 0 4px #09090b, 0 10px 44px rgba(0,0,0,0.45)",
            innerLip: "#070709",
            speaker: "rgba(255,255,255,0.18)",
          };

  return (
    <div
      style={{
        position: "relative",
        aspectRatio: `${g.aspect}`,
        ...style,
        containerType: "size",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "relative", width: `min(100cqw, calc(100cqh * ${g.aspect}))`, aspectRatio: `${g.aspect}` }}>
        {!useAppleBezelImage && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: frameRadius,
              background: chassisTheme.bg,
              boxShadow: chassisTheme.shadow,
            }}
          >
            {isIphoneTarget && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: "0.78%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "14%",
                  height: "0.42%",
                  borderRadius: 999,
                  background: chassisTheme.speaker,
                }}
              />
            )}
          </div>
        )}
        {!useAppleBezelImage && isIphoneTarget && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: `${Math.max(0, g.screen.L - 1.5)}%`,
              top: `${Math.max(0, g.screen.T - 0.75)}%`,
              width: `${Math.min(100, g.screen.W + 3.0)}%`,
              height: `${Math.min(100, g.screen.H + 1.5)}%`,
              borderRadius: `${g.radius.x + 1.1}% / ${g.radius.y + 0.5}%`,
              background: chassisTheme.innerLip,
              pointerEvents: "none",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: `${g.screen.L}%`,
            top: `${g.screen.T}%`,
            width: `${g.screen.W}%`,
            height: `${g.screen.H}%`,
            borderRadius: g.clip ?? `${g.radius.x}% / ${g.radius.y}%`,
            overflow: "hidden",
            background: "#000",
            containerType: "size",
          }}
        >
          {resolved ? (
            <img
              src={resolved}
              alt={alt}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                objectFit: device === "mac" || captureFits(src, g.screenAspect, isDuoDevice(device) ? DUO_FIT_TOLERANCE : isIphoneTarget ? PHONE_FIT_TOLERANCE : undefined) ? "cover" : "contain",
                objectPosition: device === "mac" || isIphoneTarget ? "top" : "center",
              }}
              draggable={false}
            />
          ) : hideEmpty ? null : (
            <EmptySlot />
          )}
          {!useAppleBezelImage && g.camera === "corner" && (
            // The outer display's front camera, where Apple's bezels put it: top
            // right in portrait, top left once the closed phone is turned.
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: "3.4cqmin",
                ...(g.screenAspect > 1 ? { left: "3.4cqmin" } : { right: "3.4cqmin" }),
                width: "5.6cqmin",
                height: "5.6cqmin",
                background: "#050506",
                borderRadius: 999,
                pointerEvents: "none",
              }}
            />
          )}
        </div>
        {useAppleBezelImage && g.image && (
          // The real bezel sits over the screen; its transparent cutout shows it.
          <img
            src={img(g.image.src)}
            alt=""
            data-export-check="full"
            draggable={false}
            style={
              g.image.rotate
                ? {
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: `${100 / g.aspect}%`,
                    height: `${100 * g.aspect}%`,
                    transform: "translate(-50%, -50%) rotate(-90deg)",
                    pointerEvents: "none",
                  }
                : { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }
            }
          />
        )}
      </div>
    </div>
  );
}

// One stable component per target, so switching decks doesn't remount frames.
export const DUO_FRAMES: Record<DuoDevice, React.ComponentType<FrameProps>> = {
  "duo-outer": (props) => <BezelFrame device="duo-outer" {...props} />,
  "duo-outer-landscape": (props) => <BezelFrame device="duo-outer-landscape" {...props} />,
  "duo-inner": (props) => <BezelFrame device="duo-inner" {...props} />,
  "duo-inner-landscape": (props) => <BezelFrame device="duo-inner-landscape" {...props} />,
};

const bezelFrames = new Map<Device, React.ComponentType<FrameProps>>();

/** The stable bezel frame component for a device (used once its bezel is measured). */
export function bezelFrameFor(device: Device): React.ComponentType<FrameProps> {
  let frame = bezelFrames.get(device);
  if (!frame) {
    const Component = (props: FrameProps) => <BezelFrame device={device} {...props} />;
    Component.displayName = `BezelFrame(${device})`;
    frame = Component;
    bezelFrames.set(device, frame);
  }
  return frame;
}

function EmptySlot() {
  // Sized off the slot's own width (container query units) so the hint stays
  // readable on a 4K TV canvas and still fits inside a 422 px watch face.
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        containerType: "inline-size",
        background: "linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.4)",
          fontSize: "6cqw",
          textAlign: "center",
          padding: "8%",
          boxSizing: "border-box",
        }}
      >
        Drop a screenshot here
      </div>
    </div>
  );
}

// ---------- Apple TV ----------
// The screenshot IS the content, so there is no device UI to draw. A thin dark
// bezel reads as "TV" without competing with the capture. `bare` renders the
// capture edge-to-edge with no bezel at all.
export function AppleTV({ src, alt = "", style, hideEmpty, bare }: FrameProps & { bare?: boolean }) {
  const resolved = img(src);
  return (
    <div style={{ position: "relative", aspectRatio: "16 / 9", ...style }}>
      <div
        style={{
          width: "100%", height: "100%",
          borderRadius: bare ? "0.6% / 1.1%" : "1.1% / 2.0%",
          background: bare ? "transparent" : "#0A0A0C",
          padding: bare ? "0" : "0.9%",
          boxSizing: "border-box",
          boxShadow: bare
            ? "0 18px 60px rgba(0,0,0,0.28)"
            : "0 22px 70px rgba(0,0,0,0.40), inset 0 0 0 1px rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: "100%", height: "100%", overflow: "hidden", background: "#111",
                      borderRadius: bare ? "0.6% / 1.1%" : "0.5% / 0.9%" }}>
          {resolved ? (
            <img src={resolved} alt={alt} draggable={false}
                 style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }} />
          ) : hideEmpty ? null : (<EmptySlot />)}
        </div>
      </div>
    </div>
  );
}

// ---------- Apple Watch ----------
// Cushion-shaped body with a very large corner radius, plus the digital crown and
// side button on the right. The bezel is proportionally much thicker than a phone's,
// which is what makes a watch read as a watch at small sizes.
export function AppleWatch({ src, alt = "", style, hideEmpty }: FrameProps) {
  const resolved = img(src);
  return (
    <div style={{ position: "relative", aspectRatio: "422 / 514", ...style }}>
      {/* crown + side button */}
      <div style={{ position: "absolute", right: "-2.6%", top: "27%", width: "3.4%", height: "12%",
                    background: "linear-gradient(180deg,#8E8E93,#5A5A5E)", borderRadius: "40%" }} />
      <div style={{ position: "absolute", right: "-1.8%", top: "45%", width: "2.4%", height: "14%",
                    background: "linear-gradient(180deg,#6E6E73,#48484A)", borderRadius: "40%" }} />
      <div
        style={{
          width: "100%", height: "100%",
          borderRadius: "26% / 21%",
          background: "#0A0A0C",
          padding: "6.5%",
          boxSizing: "border-box",
          boxShadow: "0 18px 50px rgba(0,0,0,0.42), inset 0 0 0 1px rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: "100%", height: "100%", overflow: "hidden", background: "#000",
                      borderRadius: "22% / 18%" }}>
          {resolved ? (
            <img src={resolved} alt={alt} draggable={false}
                 style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }} />
          ) : hideEmpty ? null : (<EmptySlot />)}
        </div>
      </div>
    </div>
  );
}

// ---------- CarPlay ----------
// A dashboard head unit: wide, squared-off, minimal bezel. Deliberately plainer than
// the TV frame because CarPlay screens are set into a fascia rather than being a
// product silhouette anyone recognises.
export function CarPlayScreen({ src, alt = "", style, hideEmpty }: FrameProps) {
  const resolved = img(src);
  return (
    <div style={{ position: "relative", aspectRatio: "800 / 480", ...style }}>
      <div
        style={{
          width: "100%", height: "100%",
          borderRadius: "2.2% / 3.6%",
          background: "#0B0B0D",
          padding: "1.6%",
          boxSizing: "border-box",
          boxShadow: "0 20px 60px rgba(0,0,0,0.40), inset 0 0 0 1px rgba(255,255,255,0.07)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: "100%", height: "100%", overflow: "hidden", background: "#000",
                      borderRadius: "1.4% / 2.3%" }}>
          {resolved ? (
            <img src={resolved} alt={alt} draggable={false}
                 style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }} />
          ) : hideEmpty ? null : (<EmptySlot />)}
        </div>
      </div>
    </div>
  );
}
