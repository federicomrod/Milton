'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Trash2, RefreshCw, FileText, Database, DollarSign } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getUploadedFilesSummary, deleteFileData, FileSummary } from '@/lib/data-service'

interface FileData {
  type: 'transactions' | 'deals' | 'budgets'
  label: string
  count: number
  icon: any
  color: string
  lastUpdated?: string
}

export function FileManagement() {
  const [files, setFiles] = useState<FileData[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const fetchFiles = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        console.warn('⚠️ No authenticated user found')
        setFiles([])
        setIsLoading(false)
        return
      }

      const summaries = await getUploadedFilesSummary(supabase, user.id)
      
      // Map summaries to FileData with icons and colors
      const fileData: FileData[] = summaries.map((summary) => {
          let type: 'transactions' | 'deals' | 'budgets'
          let icon: any
          let color: string
          
          switch (summary.name) {
            case 'transactions':
              type = 'transactions'
              icon = DollarSign
              color = 'bg-green-100 text-green-800'
              break
            case 'crm_deals':
              type = 'deals'
              icon = FileText
              color = 'bg-blue-100 text-blue-800'
              break
            case 'budgets':
              type = 'budgets'
              icon = Database
              color = 'bg-purple-100 text-purple-800'
              break
            default:
              type = 'transactions'
              icon = FileText
              color = 'bg-gray-100 text-gray-800'
          }
          
          return {
            type,
            label: summary.label,
            count: summary.count,
            icon,
            color,
            lastUpdated: summary.updated_at 
              ? new Date(summary.updated_at).toLocaleString() 
              : 'N/A'
          }
        })
      
      setFiles(fileData)
    } catch (error) {
      console.error('❌ Failed to fetch files:', error)
      setFiles([])
    } finally {
      setIsLoading(false)
    }
  }

  const deleteFile = async (type: 'transactions' | 'deals' | 'budgets') => {
    const confirmed = confirm(`Are you sure you want to delete all ${type} data? This cannot be undone.`)
    if (!confirmed) return

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        alert('No authenticated user found')
        return
      }

      // Map type to table name
      const tableName = type === 'deals' ? 'crm_deals' : type
      
      const result = await deleteFileData(supabase, user.id, tableName)
      
      if (result.success) {
        alert(`Successfully deleted all ${type} data`)
        await fetchFiles() // Refresh the list
        
        // Also clear localStorage cache if it exists
        const localKey = type === 'deals' ? 'crmDeals' : type
        localStorage.removeItem(localKey)
      } else {
        alert(`Failed to delete ${type}: ${result.error}`)
      }
    } catch (error) {
      console.error('❌ Delete operation failed:', error)
      alert('Failed to delete data. Please try again.')
    }
  }

  const refreshFiles = async () => {
    setIsRefreshing(true)
    await fetchFiles()
    setTimeout(() => setIsRefreshing(false), 500)
  }

  useEffect(() => {
    fetchFiles()

    const handleRefresh = () => fetchFiles()
    window.addEventListener('data-status:refresh', handleRefresh)

    // Refresh every 10 seconds to pick up new uploads
    const interval = setInterval(fetchFiles, 10000)

    return () => {
      clearInterval(interval)
      window.removeEventListener('data-status:refresh', handleRefresh)
    }
  }, [])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">File Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <RefreshCw className="h-12 w-12 mx-auto mb-4 text-gray-300 animate-spin" />
            <p className="text-sm">Loading file data...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (files.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">File Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium mb-2">No Files Uploaded</h3>
            <p className="text-sm">Upload your financial data files to get started.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">File Management</CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={refreshFiles}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {files.map((file) => {
            const Icon = file.icon
            return (
              <div key={file.type} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className={`${file.color} flex items-center gap-1`}>
                    <Icon className="h-3 w-3" />
                    {file.label}
                  </Badge>
                  <span className={`text-sm ${file.count === 0 ? 'text-gray-400 italic' : 'text-gray-600'}`}>
                    {file.count === 0 ? 'No records yet' : `${file.count} ${file.count === 1 ? 'record' : 'records'}`}
                  </span>
                  {file.lastUpdated && (
                    <span className="text-xs text-gray-400">
                      Updated: {file.lastUpdated}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteFile(file.type)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm font-medium text-blue-800 mb-2">File Management Tips:</h4>
          <ul className="text-xs text-blue-700 space-y-1">
            <li>• Delete files to remove them from the system</li>
            <li>• Upload new files to replace existing ones</li>
            <li>• Charts and metrics will update automatically</li>
            <li>• Use the refresh button to check for new uploads</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
} 