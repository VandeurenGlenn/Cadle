export const safeExportName = (name: string): string => (name || 'cadle-project').replace(/[^a-z0-9_-]+/gi, '-')
