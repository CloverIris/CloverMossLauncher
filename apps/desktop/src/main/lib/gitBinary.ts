import { resolveGitBinary, setupEnvironment } from 'dugite'

let configured = false

/**
 * Path to dugite's bundled Git. Also installs dugite's GIT_EXEC_PATH /
 * template / SSL environment so HTTPS remote helpers work without system Git.
 */
export function gitBinary(): string {
  if (!configured) {
    configured = true
    try {
      const { env } = setupEnvironment({})
      for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) process.env[key] = value
      }
    } catch {
      // The binary still works for local-only operations.
    }
  }
  return resolveGitBinary()
}
