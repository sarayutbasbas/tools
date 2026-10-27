export interface VideoStreamInfo {
  codec_name?: string;
  pix_fmt?: string;
  profile?: string;
  color_transfer?: string;
  time_base?: string;
}

export function mp4Encoding(videoIndex: number, audioIndex: number, source: VideoStreamInfo): string[] {
  const hdr = ['smpte2084', 'arib-std-b67'].includes(source.color_transfer || '');
  const compatible = source.codec_name === 'h264' && source.pix_fmt === 'yuv420p' &&
    ['Constrained Baseline', 'Baseline', 'Main', 'High'].includes(source.profile || '') && !hdr;
  const video = compatible ? ['-c:v', 'copy'] : [
    '-c:v', 'libx264', '-threads:v', '4', '-preset', 'fast', '-crf', '18',
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-tag:v', 'avc1',
    '-vf', [
      ...(hdr ? ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'tonemap=tonemap=mobius:desat=0', 'zscale=p=bt709:t=bt709:m=bt709:r=tv'] : []),
      'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    ].join(','),
    ...(hdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709'] : []),
    '-fps_mode:v', 'passthrough',
    ...(/^\d+\/[1-9]\d*$/.test(source.time_base || '') ? ['-enc_time_base:v', source.time_base!] : []),
  ];
  return [
    '-map', `${Math.max(0, videoIndex)}:v:0`, '-map', `${Math.max(0, audioIndex)}:a:0?`,
    ...video, '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-ac', '2', '-ar', '48000',
    '-movflags', '+faststart',
  ];
}
