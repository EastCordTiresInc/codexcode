const jpeg = require('jpeg-js');

const SAMPLE_EDGE = 240;
const MIN_EDGE = 320;
const MIN_LAPLACIAN_VARIANCE = 1400;
const MIN_CONTRAST = 12;

const UNCLEAR_PHOTO_MESSAGE = 'This photo is blurry or unclear. Hold the phone steady, tap the wheel to focus, and take it again.';

function sampleGray(data, width, height) {
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(width, height));
  const sampledWidth = Math.max(2, Math.round(width * scale));
  const sampledHeight = Math.max(2, Math.round(height * scale));
  const gray = new Float64Array(sampledWidth * sampledHeight);
  for (let y = 0; y < sampledHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / sampledHeight));
    for (let x = 0; x < sampledWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(((x + 0.5) * width) / sampledWidth));
      const index = ((sourceY * width) + sourceX) * 4;
      gray[(y * sampledWidth) + x] = (0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2]);
    }
  }
  return { gray, width: sampledWidth, height: sampledHeight };
}

function measureClarity(data, width, height) {
  if (!width || !height || width < MIN_EDGE || height < MIN_EDGE) {
    return { ok: false, reason: 'too_small', variance: 0, contrast: 0, brightness: 0 };
  }
  const sampled = sampleGray(data, width, height);
  const { gray } = sampled;
  const count = gray.length;
  let brightness = 0;
  for (let index = 0; index < count; index += 1) brightness += gray[index];
  brightness /= count;

  let deviation = 0;
  for (let index = 0; index < count; index += 1) {
    const delta = gray[index] - brightness;
    deviation += delta * delta;
  }
  const contrast = Math.sqrt(deviation / count);

  let sum = 0;
  let sumSquares = 0;
  let lapCount = 0;
  for (let y = 1; y < sampled.height - 1; y += 1) {
    for (let x = 1; x < sampled.width - 1; x += 1) {
      const index = (y * sampled.width) + x;
      const lap = gray[index - sampled.width] + gray[index - 1] + gray[index + 1] + gray[index + sampled.width] - (4 * gray[index]);
      sum += lap;
      sumSquares += lap * lap;
      lapCount += 1;
    }
  }
  const lapMean = sum / lapCount;
  const variance = (sumSquares / lapCount) - (lapMean * lapMean);
  const ok = variance >= MIN_LAPLACIAN_VARIANCE && contrast >= MIN_CONTRAST;
  return {
    ok,
    reason: ok ? '' : 'unclear',
    variance: Math.round(variance * 10) / 10,
    contrast: Math.round(contrast * 10) / 10,
    brightness: Math.round(brightness * 10) / 10,
  };
}

function photoRejectionMessage(result) {
  if (result?.reason === 'too_small') {
    return 'This photo is too small to see the wheel. Move closer and take it again.';
  }
  if (result?.reason === 'unreadable') {
    return 'This photo could not be read. Take it again.';
  }
  return UNCLEAR_PHOTO_MESSAGE;
}

function assessJpeg(buffer) {
  let decoded;
  try {
    decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 24 });
  } catch (error) {
    return { ok: false, reason: 'unreadable', variance: 0, contrast: 0, brightness: 0 };
  }
  if (!decoded?.data || !decoded.width || !decoded.height) {
    return { ok: false, reason: 'unreadable', variance: 0, contrast: 0, brightness: 0 };
  }
  return measureClarity(decoded.data, decoded.width, decoded.height);
}

module.exports = {
  SAMPLE_EDGE,
  MIN_EDGE,
  MIN_LAPLACIAN_VARIANCE,
  MIN_CONTRAST,
  UNCLEAR_PHOTO_MESSAGE,
  photoRejectionMessage,
  measureClarity,
  assessJpeg,
};
