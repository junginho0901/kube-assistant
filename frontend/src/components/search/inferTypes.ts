const MAX_STRING_LITERALS = 200
const MAX_STRING_LITERAL_LENGTH = 20

interface TypeInfoNode {
  primitiveTypes: Set<string>
  stringLiterals: Set<string>
  hasStringType: boolean
  isArray: boolean
  arrayElementInfo: TypeInfoNode | null
  isObject: boolean
  objectProperties: Map<string, TypeInfoNode>
  presenceCount: number
  parentObjectCount: number
}

function createTypeInfoNode(): TypeInfoNode {
  return {
    primitiveTypes: new Set(),
    stringLiterals: new Set(),
    hasStringType: false,
    isArray: false,
    arrayElementInfo: null,
    isObject: false,
    objectProperties: new Map(),
    presenceCount: 0,
    parentObjectCount: 0,
  }
}

function aggregateTypeInfo(value: any, node: TypeInfoNode, parentObjectCount: number): void {
  node.presenceCount++
  node.parentObjectCount = parentObjectCount

  const type = typeof value

  if (value === null) {
    node.primitiveTypes.add('null')
  } else if (type === 'string') {
    node.hasStringType = true
    node.primitiveTypes.add('string')
    if (node.stringLiterals.size < MAX_STRING_LITERALS) {
      if (value.length < MAX_STRING_LITERAL_LENGTH) {
        node.stringLiterals.add(value)
      }
    } else {
      node.stringLiterals.clear()
    }
  } else if (type === 'number') {
    node.primitiveTypes.add('number')
  } else if (type === 'boolean') {
    node.primitiveTypes.add('boolean')
  } else if (Array.isArray(value)) {
    node.isArray = true
    if (!node.arrayElementInfo) {
      node.arrayElementInfo = createTypeInfoNode()
    }
    const arrayPresenceCount = node.presenceCount
    value.forEach(element => {
      aggregateTypeInfo(element, node.arrayElementInfo!, arrayPresenceCount)
    })
    if (node.arrayElementInfo) node.arrayElementInfo.parentObjectCount = arrayPresenceCount
  } else if (type === 'object') {
    node.isObject = true
    const numObjectOccurrences = node.presenceCount
    const currentKeys = new Set<string>()

    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        currentKeys.add(key)
        if (!node.objectProperties.has(key)) {
          node.objectProperties.set(key, createTypeInfoNode())
        }
        const propertyNode = node.objectProperties.get(key)!
        aggregateTypeInfo(value[key], propertyNode, numObjectOccurrences)
      }
    }
    node.objectProperties.forEach((propNode, key) => {
      if (!currentKeys.has(key)) {
        propNode.parentObjectCount = numObjectOccurrences
      }
    })
  }
}

const validIdentifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

function generateTypeString(
  node: TypeInfoNode,
  indentation: string = '',
  maxKeysPerObject: number = 25
): string {
  const types: string[] = []

  node.primitiveTypes.forEach(type => {
    if (type !== 'string') types.push(type)
  })

  if (node.hasStringType) {
    if (node.stringLiterals.size > 0 && node.stringLiterals.size < MAX_STRING_LITERALS) {
      node.stringLiterals.forEach(literal => {
        const escaped = literal.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        types.push(`"${escaped}"`)
      })
    } else {
      types.push('string')
    }
  }

  if (node.isObject && node.objectProperties.size > 0 && node.objectProperties.size < maxKeysPerObject) {
    const propertyLines: string[] = []
    const nextIndentation = indentation + '  '
    const sortedKeys = Array.from(node.objectProperties.keys()).sort()

    for (const key of sortedKeys) {
      const propertyNode = node.objectProperties.get(key)!
      const isOptional =
        propertyNode.parentObjectCount > 0 &&
        propertyNode.presenceCount < propertyNode.parentObjectCount
      const formattedKey = validIdentifierRegex.test(key) ? key : `"${key}"`
      const optionalMarker = isOptional ? '?' : ''
      const propertyTypeString = generateTypeString(propertyNode, nextIndentation, maxKeysPerObject)
      propertyLines.push(`${nextIndentation}${formattedKey}${optionalMarker}: ${propertyTypeString};`)
    }

    if (propertyLines.length > 0) {
      types.push(`{\n${propertyLines.join('\n')}\n${indentation}}`)
    } else {
      types.push('Record<string, any>')
    }
  } else if (node.isObject) {
    types.push('Record<string, any>')
  }

  if (node.isArray) {
    if (
      node.arrayElementInfo &&
      (node.arrayElementInfo.presenceCount > 0 ||
        node.arrayElementInfo.primitiveTypes.size > 0 ||
        node.arrayElementInfo.stringLiterals.size > 0 ||
        node.arrayElementInfo.isObject ||
        node.arrayElementInfo.isArray)
    ) {
      const elementTypeString = generateTypeString(node.arrayElementInfo, indentation)
      if (
        elementTypeString.includes('|') ||
        elementTypeString.startsWith('{') ||
        elementTypeString.includes('&')
      ) {
        types.push(`(${elementTypeString})[]`)
      } else {
        types.push(`${elementTypeString}[]`)
      }
    } else {
      types.push('any[]')
    }
  }

  if (types.length === 0) return 'any'
  if (types.length === 1) return types[0]
  return types.sort().join(' | ')
}

export function generateGlobalVarDeclarations(
  objects: Record<string, any>[],
  maxKeysPerObject?: number
): string {
  if (!Array.isArray(objects) || objects.length === 0) return ''

  const topLevelPropertyNodes = new Map<string, TypeInfoNode>()
  let validObjectCount = 0

  for (const obj of objects) {
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      validObjectCount++
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (!topLevelPropertyNodes.has(key)) {
            topLevelPropertyNodes.set(key, createTypeInfoNode())
          }
          const propertyRootNode = topLevelPropertyNodes.get(key)!
          aggregateTypeInfo(obj[key], propertyRootNode, 1)
        }
      }
    }
  }

  if (validObjectCount === 0) return ''

  const declarations: string[] = []
  const sortedKeys = Array.from(topLevelPropertyNodes.keys()).sort()

  for (const key of sortedKeys) {
    if (validIdentifierRegex.test(key)) {
      const propertyNode = topLevelPropertyNodes.get(key)!
      propertyNode.parentObjectCount = propertyNode.presenceCount
      const typeString = generateTypeString(propertyNode, undefined, maxKeysPerObject)
      if (typeString !== 'any' || propertyNode.presenceCount > 0) {
        declarations.push(`declare var ${key}: ${typeString};`)
      }
    }
  }

  return declarations.join('\n\n')
}
