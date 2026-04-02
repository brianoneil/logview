/** Strip common ANSI CSI / SGR sequences (colors, bold, etc.). */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, "");
}
