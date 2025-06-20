import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { makeRequest } from '@/lib/api'

interface FileSearchResult {
  path: string
  name: string
}

interface ApiResponse<T> {
  success: boolean
  data: T | null
  message: string | null
}

interface FileSearchTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
  className?: string
  projectId?: string
}

export function FileSearchTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled = false,
  className,
  projectId
}: FileSearchTextareaProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)

  const [atSymbolPosition, setAtSymbolPosition] = useState(-1)
  const [isLoading, setIsLoading] = useState(false)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Search for files when query changes
  useEffect(() => {
    if (!searchQuery || !projectId || searchQuery.length < 1) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    const searchFiles = async () => {
      setIsLoading(true)
      try {
        const response = await makeRequest(
          `/api/projects/${projectId}/search?q=${encodeURIComponent(searchQuery)}`
        )
        
        if (response.ok) {
          const result: ApiResponse<FileSearchResult[]> = await response.json()
          if (result.success && result.data) {
            setSearchResults(result.data)
            setShowDropdown(true)
            setSelectedIndex(-1)
          }
        }
      } catch (error) {
        console.error('Failed to search files:', error)
      } finally {
        setIsLoading(false)
      }
    }

    const debounceTimer = setTimeout(searchFiles, 300)
    return () => clearTimeout(debounceTimer)
  }, [searchQuery, projectId])

  // Handle text changes and detect @ symbol
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart || 0
    
    onChange(newValue)

    // Check if @ was just typed
    const textBeforeCursor = newValue.slice(0, newCursorPosition)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')
    
    if (lastAtIndex !== -1) {
      // Check if there's no space after the @ (still typing the search query)
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
      const hasSpace = textAfterAt.includes(' ') || textAfterAt.includes('\n')
      
      if (!hasSpace) {
        setAtSymbolPosition(lastAtIndex)
        setSearchQuery(textAfterAt)
        return
      }
    }
    
    // If no valid @ context, hide dropdown
    setShowDropdown(false)
    setSearchQuery('')
    setAtSymbolPosition(-1)
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown || searchResults.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => 
          prev < searchResults.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : searchResults.length - 1
        )
        break
      case 'Enter':
        if (selectedIndex >= 0) {
          e.preventDefault()
          selectFile(searchResults[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setShowDropdown(false)
        setSearchQuery('')
        setAtSymbolPosition(-1)
        break
    }
  }

  // Select a file and insert it into the text
  const selectFile = (file: FileSearchResult) => {
    if (atSymbolPosition === -1) return
    
    const beforeAt = value.slice(0, atSymbolPosition)
    const afterQuery = value.slice(atSymbolPosition + 1 + searchQuery.length)
    const newValue = beforeAt + file.path + afterQuery
    
    onChange(newValue)
    setShowDropdown(false)
    setSearchQuery('')
    setAtSymbolPosition(-1)
    
    // Focus back to textarea
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = atSymbolPosition + file.path.length
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  // Calculate dropdown position
  const getDropdownPosition = () => {
    if (!textareaRef.current || atSymbolPosition === -1) return { top: 0, left: 0 }
    
    const textBeforeAt = value.slice(0, atSymbolPosition)
    const lines = textBeforeAt.split('\n')
    const currentLine = lines.length - 1
    const charInLine = lines[lines.length - 1].length
    
    // Rough calculation - this is an approximation
    const lineHeight = 20
    const charWidth = 8
    const top = (currentLine + 1) * lineHeight + 10
    const left = charWidth * charInLine
    
    return { top, left }
  }

  const dropdownPosition = getDropdownPosition()

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
      />
      
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 bg-background border border-border rounded-md shadow-lg max-h-60 overflow-y-auto min-w-64"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
          }}
        >
          {isLoading ? (
            <div className="p-2 text-sm text-muted-foreground">Searching...</div>
          ) : searchResults.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">No files found</div>
          ) : (
            <div className="py-1">
              {searchResults.map((file, index) => (
                <div
                  key={file.path}
                  className={`px-3 py-2 cursor-pointer text-sm ${
                    index === selectedIndex
                      ? 'bg-blue-50 text-blue-900'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => selectFile(file)}
                >
                  <div className="font-medium truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{file.path}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
