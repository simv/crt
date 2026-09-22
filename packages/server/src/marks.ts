/**
 * The mark the landing page inlines (PRD-polish F-114), verbatim from docs/brand/ — crt-mark.svg,
 * crt-mark-dark.svg and crt-mark-small.svg — as constants rather than files read at request time,
 * so the page's HTML is built from source only (nothing read from disk lands in a response).
 * test/landing.test.ts pins each one equal to its file; edit the file, then paste it here.
 */

/** docs/brand/crt-mark.svg — ink on light. */
export const MARK = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\" role=\"img\" aria-label=\"CRT\">\n<defs><clipPath id=\"a\"><path clip-rule=\"evenodd\" d=\"M0 0H128V128H0ZM87.9 32.8a18 18 0 1 0 36 0a18 18 0 1 0 -36 0Z\"/></clipPath></defs>\n<g clip-path=\"url(#a)\">\n<path fill=\"#111\" d=\"M112 64C112 99.8 107.8 103 60 103C12.2 103 8 99.8 8 64C8 28.2 12.2 25 60 25C107.8 25 112 28.2 112 64Z\"/>\n<path fill=\"#2b2b31\" d=\"M104 64C104 92.5 100.4 95 60 95C19.6 95 16 92.5 16 64C16 35.5 19.6 33 60 33C100.4 33 104 35.5 104 64Z\"/>\n</g>\n<circle cx=\"105.9\" cy=\"32.8\" r=\"16\" fill=\"#ff3d71\"/>\n<path fill=\"#fff\" d=\"M103.4 22.8h7v20h-7v-13h-6Z\"/>\n</svg>";

/** docs/brand/crt-mark-dark.svg — the light bezel for dark backgrounds. */
export const MARK_DARK = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\" role=\"img\" aria-label=\"CRT\">\n<defs><clipPath id=\"a\"><path clip-rule=\"evenodd\" d=\"M0 0H128V128H0ZM87.9 32.8a18 18 0 1 0 36 0a18 18 0 1 0 -36 0Z\"/></clipPath></defs>\n<g clip-path=\"url(#a)\">\n<path fill=\"#f2f2f4\" d=\"M112 64C112 99.8 107.8 103 60 103C12.2 103 8 99.8 8 64C8 28.2 12.2 25 60 25C107.8 25 112 28.2 112 64Z\"/>\n<path fill=\"#2b2b31\" d=\"M104 64C104 92.5 100.4 95 60 95C19.6 95 16 92.5 16 64C16 35.5 19.6 33 60 33C100.4 33 104 35.5 104 64Z\"/>\n</g>\n<circle cx=\"105.9\" cy=\"32.8\" r=\"16\" fill=\"#ff3d71\"/>\n<path fill=\"#fff\" d=\"M103.4 22.8h7v20h-7v-13h-6Z\"/>\n</svg>";

/** docs/brand/crt-mark-small.svg — the ≤ 24 px variant (the mobile header). */
export const MARK_SMALL = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" role=\"img\" aria-label=\"CRT\">\n<defs><clipPath id=\"c\"><path clip-rule=\"evenodd\" d=\"M0 0H16V16H0ZM11 4a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z\"/></clipPath></defs>\n<path fill=\"#111\" clip-path=\"url(#c)\" d=\"M15 8C15 4 14 3 8 3 2 3 1 4 1 8c0 4 1 5 7 5s7-1 7-5Z\"/>\n<circle cx=\"14\" cy=\"4\" r=\"2\" fill=\"#ff3d71\"/>\n</svg>";
