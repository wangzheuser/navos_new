export interface VideoFormValues {
  model: string;
  prompt: string;
  negativePrompt?: string;
  resolution: string;
  aspectRatio: string;
  durationSeconds: number;
  audio: boolean;
}

export interface VideoReferenceValue {
  source: string;
  role?: string;
}

export interface VideoReferenceValues {
  referenceText?: string;
  images?: VideoReferenceValue[];
  videos?: VideoReferenceValue[];
  audios?: VideoReferenceValue[];
}

export function buildVideoGenerationPayload(
  form: VideoFormValues,
  references: VideoReferenceValues = {}
): Record<string, unknown> {
  const images = normalizeReferences(references.images, 9, "reference_image");
  const videos = normalizeReferences(references.videos, 3, "reference_video");
  const audios = normalizeReferences(references.audios, 3, "reference_audio");
  const hasFrameImages = images.some((image) => isFrameImageRole(image.role));
  const hasOmniReferences = images.some((image) => !isFrameImageRole(image.role))
    || videos.length > 0
    || audios.length > 0;

  // 首帧/尾帧图生视频与全能参考是互斥的上游生成场景。
  if (hasFrameImages && hasOmniReferences) {
    throw new Error("首帧/尾帧不能与全能参考图片、视频或音频混用");
  }

  const payload: Record<string, unknown> = {
    model: form.model,
    prompt: withReferenceText(form.prompt.trim(), references.referenceText),
    resolution: form.resolution,
    aspectRatio: form.aspectRatio,
    durationSeconds: form.durationSeconds,
    audio: form.audio || audios.length > 0,
    timeoutMs: 600000
  };
  const negativePrompt = form.negativePrompt?.trim();
  if (negativePrompt) {
    payload.negative_prompt = negativePrompt;
  }

  if (hasOmniReferences) {
    payload.mode = "omni_reference";
    payload.generation_mode = "omni_reference";
  }
  if (images.length > 0) {
    payload.images = images.map((item) => item.source);
    payload.imageRoles = images.map((item) => item.role);
  }
  if (videos.length > 0) {
    payload.videos = videos.map((item) => item.source);
    payload.videoRoles = videos.map((item) => item.role);
  }
  if (audios.length > 0) {
    payload.audioRefs = audios.map((item) => item.source);
    payload.audioRoles = audios.map((item) => item.role);
  }

  return payload;
}

/** 判断图片角色是否属于严格首帧/尾帧场景。 */
function isFrameImageRole(role: string): boolean {
  return ["first_frame", "first_frame_image", "last_frame", "last_frame_image"].includes(role);
}

export function parseReferenceUrls(value: string, role: string): VideoReferenceValue[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((source) => ({ source, role }));
}

function withReferenceText(prompt: string, referenceText?: string): string {
  const text = referenceText?.trim();
  return text ? `${prompt}\n\n参考文字：${text}` : prompt;
}

function normalizeReferences(
  references: VideoReferenceValue[] | undefined,
  max: number,
  defaultRole: string
): Required<VideoReferenceValue>[] {
  const result: Required<VideoReferenceValue>[] = [];
  for (const reference of references ?? []) {
    const source = reference.source.trim();
    if (!source || result.some((item) => item.source === source)) {
      continue;
    }
    result.push({ source, role: reference.role || defaultRole });
    if (result.length >= max) {
      break;
    }
  }
  return result;
}
