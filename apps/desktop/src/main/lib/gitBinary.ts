import { resolveGitBinary } from 'dugite'

/** Path to dugite's bundled Git. Never use a system `git` for local operations. */
export function gitBinary(): string {
  return resolveGitBinary()
}
