export interface LoopHandle {
  stop: () => void;
  promise: Promise<void>;
}
