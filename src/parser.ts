import { extname } from "node:path";
import type { FilePathToUrlPathOptions } from "./types/parser.js";

function toRouteSegment(segment: string): string {
  const dynamicMatch = segment.match(/^\[(.+)\]$/);

  if (!dynamicMatch) {
    return segment;
  }

  return `:${dynamicMatch[1]}`;
}

function normalizeBasePath(basePath: string): string[] {
  return basePath
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

function findSegmentSequence(
  segments: string[],
  sequence: string[],
): number | null {
  if (sequence.length === 0 || sequence.length > segments.length) {
    return null;
  }

  for (let index = 0; index <= segments.length - sequence.length; index += 1) {
    const isMatch = sequence.every(
      (sequenceSegment, offset) => segments[index + offset] === sequenceSegment,
    );

    if (isMatch) {
      return index;
    }
  }

  return null;
}

export function filePathToUrlPath(
  filePath: string,
  options: FilePathToUrlPathOptions = {},
): string {
  const basePathSegments = normalizeBasePath(options.basePath ?? "routes");
  const normalizedPath = filePath.replaceAll("\\", "/");
  const extension = extname(normalizedPath);
  const withoutExtension = extension
    ? normalizedPath.slice(0, -extension.length)
    : normalizedPath;

  const rawSegments = withoutExtension
    .split("/")
    .filter((segment) => segment.length > 0);

  const routeRootIndex = findSegmentSequence(rawSegments, basePathSegments);
  const scopedSegments =
    routeRootIndex !== null
      ? rawSegments.slice(routeRootIndex + basePathSegments.length)
      : rawSegments;

  const withoutIndexLike = [...scopedSegments];
  const lastSegment = withoutIndexLike.at(-1);

  if (lastSegment === "route" || lastSegment === "index") {
    withoutIndexLike.pop();
  }

  const routeSegments = withoutIndexLike.map(toRouteSegment).filter(Boolean);

  if (routeSegments.length === 0) {
    return "/";
  }

  return `/${routeSegments.join("/")}`;
}
