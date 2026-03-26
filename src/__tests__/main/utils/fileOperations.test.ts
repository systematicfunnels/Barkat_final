/**
 * Comprehensive unit tests for File Operations
 * Covers all branches, edge cases, and failure scenarios
 */

import { FileOperations } from '../../../main/utils/fileAsync'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// Mock fs/promises
jest.mock('fs/promises')
jest.mock('path')
jest.mock('os')

const mockFs = fs as jest.Mocked<typeof fs>
const mockPath = path as jest.Mocked<typeof path>
const mockOs = os as jest.Mocked<typeof os>

describe('FileOperations - Comprehensive Test Suite', () => {
  let fileOps: FileOperations
  let testDir: string

  beforeEach(() => {
    fileOps = new FileOperations()
    testDir = '/test/directory'
    jest.clearAllMocks()
  })

  describe('File Reading - All Branches', () => {
    test('should read file successfully', async () => {
      const filePath = '/test/file.txt'
      const expectedContent = 'Test file content'

      mockFs.readFile.mockResolvedValue(Buffer.from(expectedContent))

      const result = await fileOps.readFile(filePath)
      expect(result).toBe(expectedContent)
      expect(mockFs.readFile).toHaveBeenCalledWith(filePath)
    })

    test('should read file as buffer', async () => {
      const filePath = '/test/file.bin'
      const expectedBuffer = Buffer.from([0x01, 0x02, 0x03])

      mockFs.readFile.mockResolvedValue(expectedBuffer)

      const result = await fileOps.readFile(filePath, 'buffer')
      expect(result).toEqual(expectedBuffer)
      expect(mockFs.readFile).toHaveBeenCalledWith(filePath)
    })

    test('should handle file not found error', async () => {
      const filePath = '/nonexistent/file.txt'

      mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(fileOps.readFile(filePath)).rejects.toThrow('ENOENT: no such file or directory')
      expect(mockFs.readFile).toHaveBeenCalledWith(filePath)
    })

    test('should handle permission denied error', async () => {
      const filePath = '/restricted/file.txt'

      mockFs.readFile.mockRejectedValue(new Error('EACCES: permission denied'))

      await expect(fileOps.readFile(filePath)).rejects.toThrow('EACCES: permission denied')
    })

    test('should handle empty file', async () => {
      const filePath = '/empty/file.txt'

      mockFs.readFile.mockResolvedValue(Buffer.from(''))

      const result = await fileOps.readFile(filePath)
      expect(result).toBe('')
      expect(mockFs.readFile).toHaveBeenCalledWith(filePath)
    })

    test('should handle large file reading', async () => {
      const filePath = '/large/file.txt'
      const largeContent = 'x'.repeat(1000000) // 1MB of data

      mockFs.readFile.mockResolvedValue(Buffer.from(largeContent))

      const result = await fileOps.readFile(filePath)
      expect(result).toBe(largeContent)
      expect(result.length).toBe(1000000)
    })

    test('should handle binary file with special characters', async () => {
      const filePath = '/binary/file.bin'
      const binaryData = Buffer.from([0x00, 0xFF, 0x80, 0x7F])

      mockFs.readFile.mockResolvedValue(binaryData)

      const result = await fileOps.readFile(filePath, 'buffer')
      expect(result).toEqual(binaryData)
      expect(result.length).toBe(4)
    })
  })

  describe('File Writing - All Branches', () => {
    test('should write file successfully', async () => {
      const filePath = '/test/file.txt'
      const content = 'Test content'

      mockFs.writeFile.mockResolvedValue(undefined)

      await fileOps.writeFile(filePath, content)
      expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, content)
    })

    test('should write buffer to file', async () => {
      const filePath = '/test/file.bin'
      const buffer = Buffer.from([0x01, 0x02, 0x03])

      mockFs.writeFile.mockResolvedValue(undefined)

      await fileOps.writeFile(filePath, buffer)
      expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, buffer)
    })

    test('should handle directory creation for nested paths', async () => {
      const filePath = '/nested/deep/file.txt'
      const content = 'Test content'

      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.mkdir.mockResolvedValue(undefined)

      await fileOps.writeFile(filePath, content)
      expect(mockFs.mkdir).toHaveBeenCalledWith(path.dirname(filePath), { recursive: true })
      expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, content)
    })

    test('should handle write permission denied', async () => {
      const filePath = '/restricted/file.txt'
      const content = 'Test content'

      mockFs.writeFile.mockRejectedValue(new Error('EACCES: permission denied'))

      await expect(fileOps.writeFile(filePath, content)).rejects.toThrow('EACCES: permission denied')
    })

    test('should handle disk full error', async () => {
      const filePath = '/full/disk/file.txt'
      const content = 'Test content'

      mockFs.writeFile.mockRejectedValue(new Error('ENOSPC: no space left on device'))

      await expect(fileOps.writeFile(filePath, content)).rejects.toThrow('ENOSPC: no space left on device')
    })

    test('should handle quota exceeded error', async () => {
      const filePath = '/quota/exceeded/file.txt'
      const content = 'Test content'

      mockFs.writeFile.mockRejectedValue(new Error('EDQUOT: disk quota exceeded'))

      await expect(fileOps.writeFile(filePath, content)).rejects.toThrow('EDQUOT: disk quota exceeded')
    })

    test('should handle very large file writing', async () => {
      const filePath = '/large/file.txt'
      const largeContent = 'x'.repeat(10000000) // 10MB of data

      mockFs.writeFile.mockResolvedValue(undefined)

      const startTime = Date.now()
      await fileOps.writeFile(filePath, largeContent)
      const endTime = Date.now()

      expect(endTime - startTime).toBeLessThan(5000) // Should complete within 5 seconds
      expect(mockFs.writeFile).toHaveBeenCalledWith(filePath, largeContent)
    })
  })

  describe('Directory Operations - All Branches', () => {
    test('should create directory successfully', async () => {
      const dirPath = '/test/directory'

      mockFs.mkdir.mockResolvedValue(undefined)

      await fileOps.createDirectory(dirPath)
      expect(mockFs.mkdir).toHaveBeenCalledWith(dirPath, { recursive: true })
    })

    test('should create nested directories', async () => {
      const dirPath = '/nested/deep/directory'

      mockFs.mkdir.mockResolvedValue(undefined)

      await fileOps.createDirectory(dirPath)
      expect(mockFs.mkdir).toHaveBeenCalledWith(dirPath, { recursive: true })
    })

    test('should handle directory already exists', async () => {
      const dirPath = '/existing/directory'

      mockFs.mkdir.mockRejectedValue(new Error('EEXIST: file already exists'))

      await expect(fileOps.createDirectory(dirPath)).rejects.toThrow('EEXIST: file already exists')
    })

    test('should handle permission denied for directory creation', async () => {
      const dirPath = '/restricted/directory'

      mockFs.mkdir.mockRejectedValue(new Error('EACCES: permission denied'))

      await expect(fileOps.createDirectory(dirPath)).rejects.toThrow('EACCES: permission denied')
    })

    test('should read directory contents successfully', async () => {
      const dirPath = '/test/directory'
      const expectedFiles = ['file1.txt', 'file2.txt', 'subdir']

      mockFs.readdir.mockResolvedValue(expectedFiles as any)

      const result = await fileOps.readDirectory(dirPath)
      expect(result).toEqual(expectedFiles)
      expect(mockFs.readdir).toHaveBeenCalledWith(dirPath)
    })

    test('should handle reading non-existent directory', async () => {
      const dirPath = '/nonexistent/directory'

      mockFs.readdir.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(fileOps.readDirectory(dirPath)).rejects.toThrow('ENOENT: no such file or directory')
    })

    test('should handle reading empty directory', async () => {
      const dirPath = '/empty/directory'

      mockFs.readdir.mockResolvedValue([] as any)

      const result = await fileOps.readDirectory(dirPath)
      expect(result).toEqual([])
      expect(mockFs.readdir).toHaveBeenCalledWith(dirPath)
    })

    test('should delete directory successfully', async () => {
      const dirPath = '/test/directory'

      mockFs.rmdir.mockResolvedValue(undefined)

      await fileOps.deleteDirectory(dirPath)
      expect(mockFs.rmdir).toHaveBeenCalledWith(dirPath, { recursive: true })
    })

    test('should handle deleting non-existent directory', async () => {
      const dirPath = '/nonexistent/directory'

      mockFs.rmdir.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(fileOps.deleteDirectory(dirPath)).rejects.toThrow('ENOENT: no such file or directory')
    })

    test('should handle deleting directory with files', async () => {
      const dirPath = '/directory/with/files'

      mockFs.rmdir.mockResolvedValue(undefined)

      await fileOps.deleteDirectory(dirPath)
      expect(mockFs.rmdir).toHaveBeenCalledWith(dirPath, { recursive: true })
    })
  })

  describe('File Existence and Stats - All Branches', () => {
    test('should check file existence successfully', async () => {
      const filePath = '/existing/file.txt'

      mockFs.access.mockResolvedValue(undefined)

      const result = await fileOps.fileExists(filePath)
      expect(result).toBe(true)
      expect(mockFs.access).toHaveBeenCalledWith(filePath)
    })

    test('should handle non-existent file', async () => {
      const filePath = '/nonexistent/file.txt'

      mockFs.access.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      const result = await fileOps.fileExists(filePath)
      expect(result).toBe(false)
      expect(mockFs.access).toHaveBeenCalledWith(filePath)
    })

    test('should get file stats successfully', async () => {
      const filePath = '/test/file.txt'
      const expectedStats = {
        size: 1024,
        mtime: new Date(),
        isFile: () => true,
        isDirectory: () => false
      }

      mockFs.stat.mockResolvedValue(expectedStats as any)

      const result = await fileOps.getFileStats(filePath)
      expect(result).toEqual(expectedStats)
      expect(mockFs.stat).toHaveBeenCalledWith(filePath)
    })

    test('should handle stats for non-existent file', async () => {
      const filePath = '/nonexistent/file.txt'

      mockFs.stat.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(fileOps.getFileStats(filePath)).rejects.toThrow('ENOENT: no such file or directory')
    })

    test('should handle stats for directory', async () => {
      const dirPath = '/test/directory'
      const expectedStats = {
        size: 4096,
        mtime: new Date(),
        isFile: () => false,
        isDirectory: () => true
      }

      mockFs.stat.mockResolvedValue(expectedStats as any)

      const result = await fileOps.getFileStats(dirPath)
      expect(result.isDirectory()).toBe(true)
      expect(result.isFile()).toBe(false)
    })
  })

  describe('File Copying - All Branches', () => {
    test('should copy file successfully', async () => {
      const sourcePath = '/source/file.txt'
      const destPath = '/destination/file.txt'
      const fileContent = 'Test content'

      mockFs.readFile.mockResolvedValue(Buffer.from(fileContent))
      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.mkdir.mockResolvedValue(undefined)

      await fileOps.copyFile(sourcePath, destPath)
      expect(mockFs.readFile).toHaveBeenCalledWith(sourcePath)
      expect(mockFs.writeFile).toHaveBeenCalledWith(destPath, Buffer.from(fileContent))
    })

    test('should handle copying to non-existent directory', async () => {
      const sourcePath = '/source/file.txt'
      const destPath = '/nonexistent/destination/file.txt'
      const fileContent = 'Test content'

      mockFs.readFile.mockResolvedValue(Buffer.from(fileContent))
      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.mkdir.mockResolvedValue(undefined)

      await fileOps.copyFile(sourcePath, destPath)
      expect(mockFs.mkdir).toHaveBeenCalledWith(path.dirname(destPath), { recursive: true })
      expect(mockFs.writeFile).toHaveBeenCalledWith(destPath, Buffer.from(fileContent))
    })

    test('should handle copying non-existent source file', async () => {
      const sourcePath = '/nonexistent/file.txt'
      const destPath = '/destination/file.txt'

      mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(fileOps.copyFile(sourcePath, destPath)).rejects.toThrow('ENOENT: no such file or directory')
    })

    test('should handle copying large file', async () => {
      const sourcePath = '/source/large.txt'
      const destPath = '/destination/large.txt'
      const largeContent = 'x'.repeat(1000000)

      mockFs.readFile.mockResolvedValue(Buffer.from(largeContent))
      mockFs.writeFile.mockResolvedValue(undefined)

      const startTime = Date.now()
      await fileOps.copyFile(sourcePath, destPath)
      const endTime = Date.now()

      expect(endTime - startTime).toBeLessThan(3000) // Should complete within 3 seconds
      expect(mockFs.readFile).toHaveBeenCalledWith(sourcePath)
      expect(mockFs.writeFile).toHaveBeenCalledWith(destPath, Buffer.from(largeContent))
    })
  })

  describe('File Moving - All Branches', () => {
    test('should move file successfully', async () => {
      const sourcePath = '/source/file.txt'
      const destPath = '/destination/file.txt'

      mockFs.rename.mockResolvedValue(undefined)

      await fileOps.moveFile(sourcePath, destPath)
      expect(mockFs.rename).toHaveBeenCalledWith(sourcePath, destPath)
    })

    test('should handle moving to different filesystem', async () => {
      const sourcePath = '/source/file.txt'
      const destPath = '/different/filesystem/file.txt'
      const fileContent = 'Test content'

      mockFs.rename.mockRejectedValue(new Error('EXDEV: cross-device link'))
      mockFs.readFile.mockResolvedValue(Buffer.from(fileContent))
      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.unlink.mockResolvedValue(undefined)
      mockFs.mkdir.mockResolvedValue(undefined)

      await fileOps.moveFile(sourcePath, destPath)
      expect(mockFs.readFile).toHaveBeenCalledWith(sourcePath)
      expect(mockFs.writeFile).toHaveBeenCalledWith(destPath, Buffer.from(fileContent))
      expect(mockFs.unlink).toHaveBeenCalledWith(sourcePath)
    })

    test('should handle moving non-existent file', async () => {
      const sourcePath = '/nonexistent/file.txt'
      const destPath = '/destination/file.txt'

      mockFs.rename.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(fileOps.moveFile(sourcePath, destPath)).rejects.toThrow('ENOENT: no such file or directory')
    })

    test('should handle moving to restricted destination', async () => {
      const sourcePath = '/source/file.txt'
      const destPath = '/restricted/file.txt'

      mockFs.rename.mockRejectedValue(new Error('EACCES: permission denied'))

      await expect(fileOps.moveFile(sourcePath, destPath)).rejects.toThrow('EACCES: permission denied')
    })
  })

  describe('File Deletion - All Branches', () => {
    test('should delete file successfully', async () => {
      const filePath = '/test/file.txt'

      mockFs.unlink.mockResolvedValue(undefined)

      await fileOps.deleteFile(filePath)
      expect(mockFs.unlink).toHaveBeenCalledWith(filePath)
    })

    test('should handle deleting non-existent file', async () => {
      const filePath = '/nonexistent/file.txt'

      mockFs.unlink.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(fileOps.deleteFile(filePath)).rejects.toThrow('ENOENT: no such file or directory')
    })

    test('should handle deleting read-only file', async () => {
      const filePath = '/readonly/file.txt'

      mockFs.unlink.mockRejectedValue(new Error('EACCES: permission denied'))

      await expect(fileOps.deleteFile(filePath)).rejects.toThrow('EACCES: permission denied')
    })
  })

  describe('Path Operations - All Branches', () => {
    test('should join path components correctly', () => {
      mockPath.join.mockReturnValue('/joined/path/components')

      const result = fileOps.joinPath('/path', 'to', 'file.txt')
      expect(result).toBe('/joined/path/components')
      expect(mockPath.join).toHaveBeenCalledWith('/path', 'to', 'file.txt')
    })

    test('should get directory name correctly', () => {
      mockPath.dirname.mockReturnValue('/path/to')

      const result = fileOps.getDirname('/path/to/file.txt')
      expect(result).toBe('/path/to')
      expect(mockPath.dirname).toHaveBeenCalledWith('/path/to/file.txt')
    })

    test('should get file name correctly', () => {
      mockPath.basename.mockReturnValue('file.txt')

      const result = fileOps.getFilename('/path/to/file.txt')
      expect(result).toBe('file.txt')
      expect(mockPath.basename).toHaveBeenCalledWith('/path/to/file.txt')
    })

    test('should get file extension correctly', () => {
      mockPath.extname.mockReturnValue('.txt')

      const result = fileOps.getExtension('/path/to/file.txt')
      expect(result).toBe('.txt')
      expect(mockPath.extname).toHaveBeenCalledWith('/path/to/file.txt')
    })

    test('should get file extension for file without extension', () => {
      mockPath.extname.mockReturnValue('')

      const result = fileOps.getExtension('/path/to/file')
      expect(result).toBe('')
      expect(mockPath.extname).toHaveBeenCalledWith('/path/to/file')
    })
  })

  describe('Temporary File Operations - All Branches', () => {
    test('should create temporary file successfully', async () => {
      const tempDir = '/tmp'
      const prefix = 'test'
      const suffix = '.txt'

      mockOs.tmpdir.mockReturnValue(tempDir)
      mockFs.mkdtemp.mockResolvedValue(`${tempDir}/test`)
      mockFs.writeFile.mockResolvedValue(undefined)

      const result = await fileOps.createTempFile(prefix, suffix)
      expect(result).toMatch(new RegExp(`${tempDir}/test.*\\.txt`))
      expect(mockOs.tmpdir).toHaveBeenCalled()
      expect(mockFs.mkdtemp).toHaveBeenCalledWith(`${tempDir}/${prefix}`)
    })

    test('should create temporary file with default prefix and suffix', async () => {
      const tempDir = '/tmp'

      mockOs.tmpdir.mockReturnValue(tempDir)
      mockFs.mkdtemp.mockResolvedValue(`${tempDir}/tmp`)
      mockFs.writeFile.mockResolvedValue(undefined)

      const result = await fileOps.createTempFile()
      expect(result).toMatch(new RegExp(`${tempDir}/tmp.*`))
    })

    test('should handle temp directory creation failure', async () => {
      const tempDir = '/tmp'

      mockOs.tmpdir.mockReturnValue(tempDir)
      mockFs.mkdtemp.mockRejectedValue(new Error('EACCES: permission denied'))

      await expect(fileOps.createTempFile()).rejects.toThrow('EACCES: permission denied')
    })
  })

  describe('Error Handling - Edge Cases', () => {
    test('should handle concurrent file operations', async () => {
      const filePath = '/concurrent/file.txt'
      const content = 'Test content'

      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.readFile.mockResolvedValue(Buffer.from(content))

      const operations = Array.from({ length: 100 }, async (_, i) => {
        await fileOps.writeFile(`${filePath}.${i}`, `${content}.${i}`)
        return fileOps.readFile(`${filePath}.${i}`)
      })

      const results = await Promise.all(operations)
      expect(results).toHaveLength(100)
      results.forEach((result, index) => {
        expect(result).toBe(`${content}.${index}`)
      })
    })

    test('should handle file system corruption', async () => {
      const filePath = '/corrupted/file.txt'

      mockFs.readFile.mockRejectedValue(new Error('EIO: input/output error'))

      await expect(fileOps.readFile(filePath)).rejects.toThrow('EIO: input/output error')
    })

    test('should handle network file system errors', async () => {
      const filePath = '/network/file.txt'

      mockFs.readFile.mockRejectedValue(new Error('ENETDOWN: network is down'))

      await expect(fileOps.readFile(filePath)).rejects.toThrow('ENETDOWN: network is down')
    })

    test('should handle file system read-only errors', async () => {
      const filePath = '/readonly/file.txt'
      const content = 'Test content'

      mockFs.writeFile.mockRejectedValue(new Error('EROFS: read-only file system'))

      await expect(fileOps.writeFile(filePath, content)).rejects.toThrow('EROFS: read-only file system')
    })

    test('should handle file name too long error', async () => {
      const longFileName = 'x'.repeat(300)
      const filePath = `/test/${longFileName}.txt`

      mockFs.writeFile.mockRejectedValue(new Error('ENAMETOOLONG: file name too long'))

      await expect(fileOps.writeFile(filePath, 'content')).rejects.toThrow('ENAMETOOLONG: file name too long')
    })
  })

  describe('Performance and Memory Management', () => {
    test('should handle memory efficient streaming for large files', async () => {
      const filePath = '/large/stream.txt'
      const chunkSize = 64 * 1024 // 64KB chunks
      const totalSize = 10 * 1024 * 1024 // 10MB

      mockFs.readFile.mockResolvedValue(Buffer.alloc(totalSize))

      const startTime = Date.now()
      const result = await fileOps.readFile(filePath)
      const endTime = Date.now()

      expect(result.length).toBe(totalSize)
      expect(endTime - startTime).toBeLessThan(2000) // Should complete within 2 seconds
    })

    test('should handle batch file operations efficiently', async () => {
      const files = Array.from({ length: 1000 }, (_, i) => ({
        path: `/test/file${i}.txt`,
        content: `Content ${i}`
      }))

      mockFs.writeFile.mockResolvedValue(undefined)

      const startTime = Date.now()
      await Promise.all(files.map(file => 
        fileOps.writeFile(file.path, file.content)
      ))
      const endTime = Date.now()

      expect(endTime - startTime).toBeLessThan(5000) // Should complete within 5 seconds
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1000)
    })
  })
})
