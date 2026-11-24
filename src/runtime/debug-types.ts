export const DEBUG_SAB_BYTE_LENGTH = 8192;

// Int32Array header slots in bytes 0..1023
export const DEBUG_SLOT_CMD = 0;
export const DEBUG_SLOT_SEQ = 1;
export const DEBUG_SLOT_BP_VERSION = 2;
export const DEBUG_SLOT_BP_COUNT = 3;
export const DEBUG_SLOT_EVAL_LEN = 4;
export const DEBUG_SLOT_BP_JSON_LEN = 5;
export const DEBUG_SLOT_FRAME_IDX = 6;

// UTF-8 payload byte offsets inside debugSab
export const DEBUG_EVAL_BYTE_OFFSET = 1024;
export const DEBUG_EVAL_MAX_BYTES = 3072;
export const DEBUG_BP_BYTE_OFFSET = 4096;
export const DEBUG_BP_MAX_BYTES = 4096;

export const DEBUG_CMD_IDLE = 0;
export const DEBUG_CMD_CONTINUE = 1;
export const DEBUG_CMD_STEP_OVER = 2;
export const DEBUG_CMD_STEP_INTO = 3;
export const DEBUG_CMD_STEP_OUT = 4;
export const DEBUG_CMD_PAUSE = 5;
export const DEBUG_CMD_STOP = 6;
export const DEBUG_CMD_EVAL = 7;
export const DEBUG_CMD_SELECT_FRAME = 8;

export interface DebugVariableNode {
  name: string;
  type: string;
  preview: string;
  colorHex?: string;
  expandable?: boolean;
  children?: DebugVariableNode[];
}

export interface DebugStackFrame {
  index: number;
  filename: string;
  lineno: number;
  funcName: string;
}

export interface DebugPausePayload {
  filename: string;
  lineno: number;
  reason: 'step' | 'breakpoint' | 'pause' | 'exception';
  exceptionText?: string;
  selectedFrameIndex: number;
  stack: DebugStackFrame[];
  locals: DebugVariableNode[];
  globals: DebugVariableNode[];
}

export interface DebugEvalResult {
  expr: string;
  ok: boolean;
  value?: string;
  type?: string;
  colorHex?: string;
  error?: string;
}
