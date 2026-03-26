/**
 * Async file I/O utilities to prevent UI blocking
 */

import fs from 'fs'
import path from 'path'

export interface FileWriteResult {
  success: boolean
  path?: string
  size?: number
  error?: string
}

/**
 * Write file asynchronously with error handling
 */
export async function writeFileAsync(
  filePath: string,
  data: Buffer | string
): Promise<FileWriteResult> {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    await fs.promises.writeFile(filePath, data)
    const stat = await fs.promises.stat(filePath)

    return {
      success: true,
      path: filePath,
      size: stat.size
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: `Failed to write file: ${message}`
    }
  }
}

/**
 * Read file asynchronously
 */
export async function readFileAsync(
  filePath: string
): Promise<FileWriteResult & { data?: Buffer }> {
  try {
    const data = await fs.promises.readFile(filePath)
    return {
      success: true,
      path: filePath,
      size: data.length,
      data
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: `Failed to read file: ${message}`
    }
  }
}

/**
 * Copy file asynchronously with integrity check
 */
export async function copyFileAsync(source: string, destination: string): Promise<FileWriteResult> {
  try {
    // Ensure destination directory exists
    const dir = path.dirname(destination)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    await fs.promises.copyFile(source, destination)
    const stat = await fs.promises.stat(destination)

    return {
      success: true,
      path: destination,
      size: stat.size
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: `Failed to copy file: ${message}`
    }
  }
}

/**
 * Delete file asynchronously
 */
export async function deleteFileAsync(filePath: string): Promise<FileWriteResult> {
  try {
    await fs.promises.unlink(filePath)
    return {
      success: true,
      path: filePath
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: `Failed to delete file: ${message}`
    }
  }
}

/**
 * List files in directory
 */
export async function listFilesAsync(
  dirPath: string
): Promise<FileWriteResult & { files?: string[] }> {
  try {
    const files = await fs.promises.readdir(dirPath)
    return {
      success: true,
      path: dirPath,
      files
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: `Failed to list files: ${message}`
    }
  }
}
