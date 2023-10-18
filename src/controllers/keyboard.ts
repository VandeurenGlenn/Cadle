import { Object, util, IText, Group, ActiveSelection } from 'fabric'

const isMac = navigator.userAgent.indexOf('Mac OS X') != -1

const shell = document.querySelector('app-shell')

const currentSelected = () => shell.renderRoot.querySelector('custom-pages').querySelector('draw-field.custom-selected')
let currentObjectInClipboard

cadleShell.lastNumber = 1 
cadleShell.currentText = 'A1'

const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('')

const incrementLetter = (matches) => {
  let text = ''
      
  if (matches?.length > 0) {
    if (matches.length > 1) {
      if (matches[1] === 'Z') {
        text = `${matches[0]}A`
      } else {
        text = `${matches[0]}${alphabet[alphabet.indexOf(matches[1].toLowerCase()) + 1].toUpperCase()}`
      }
      
    } else {
      if (matches[0] === 'Z') {
        text = 'AA'
      } else {
        text = alphabet[alphabet.indexOf(matches[0].toLowerCase()) + 1].toUpperCase()
      }
      
    }
  }
  return text
}

const positionObject = () => {
  const drawerRect = shell.drawer.shadowRoot.querySelector('custom-pane').getBoundingClientRect()
  const actionsRect = shell.actions.getBoundingClientRect()
  return {
    left: currentMousePosition.x - drawerRect.right - drawerRect.x - 8,
    top: currentMousePosition.y - actionsRect.height - actionsRect.y - 16
  }
}

addEventListener('keydown', async event => {
  const field = currentSelected()
  const canvas = field.canvas
  if (event.metaKey && isMac && event.key === 'Backspace' || event.ctrlKey && event.key === 'Backspace' && !isMac) {
    let items = field.canvas.getActiveObjects()
    
    for (const item of items) {
      if (item.type === 'activeselection') {
        for (const _item of item._objects) {
          field.canvas.remove(_item)
        }
      }
      canvas.remove(item)
      canvas.discardActiveObject();
    }
    
   
  }

  if (event.metaKey && event.key === 'a' || event.ctrlKey && event.key === 'a') {

    canvas.discardActiveObject();
    var sel = new ActiveSelection(canvas.getObjects(), {
      canvas: canvas,
    });
    canvas.setActiveObject(sel);
    event.preventDefault()
  }


  if (event.metaKey && isMac && event.key === 'c' || event.ctrlKey && event.key === 'c' && !isMac) {

    
    const items = field.canvas.getActiveObjects()

    const activeGroup = items[0].group || items[0]

    const group = new Group(items)

    for (const item of items) {
      field.canvas.remove(item)
    }
    
    field.canvas.add(group)

    currentObjectInClipboard = group.clone()
  }

  if (event.metaKey && isMac && event.key === 'x' || event.ctrlKey && event.key === 'x' && !isMac) {
    
    const items = field.canvas.getActiveObjects()

    const activeGroup = items[0].group || items[0]
    
    for (const item of items) {
      if (item.type === 'activeselection') {
        for (const _item of item._objects) {
          field.canvas.remove(_item)
        }
      }
      canvas.discardActiveObject();
      canvas.remove(item)
    }


    const group = new Group(items)

    currentObjectInClipboard = group.clone()
  }

  if (event.metaKey && isMac && event.ctrlKey && event.key === 'g' || event.ctrlKey && event.key === 'g' && !isMac) {
    
    let items = field.canvas.getActiveObjects()
    const group = field.canvas.getActiveObjects()[0].group;
    // items = items.map(i => field.canvas.item(i.index))

    for (const item of items) {
      field.canvas.remove(item)
    }
    
    field.canvas.add(new Group(items, {
      left: group.left,
      top: group.top
    }))
  }

  if (event.metaKey && isMac && event.ctrlKey && event.key === 'u' || event.ctrlKey && event.key === 'u' && !isMac) {
   console.log('u');
   event.preventDefault()
    let items = field.canvas.getActiveObjects()
console.log(items);

    canvas.discardActiveObject();
    

    items[0].dispose()
    field.canvas.remove(items[0])

      for(const item of items[0]._objects) {
        item.set('dirty', true)
        canvas.add(item);
    }
    field.canvas.requestRenderAll()
  }

  if (event.metaKey && isMac && event.key === 'v' || event.ctrlKey && event.key === 'v' && !isMac) {
    // const json = await currentObjectInClipboard.cloneAsImage()
    const json = await currentObjectInClipboard
    const { left, top } = positionObject()
    json.left = left - (json.width / 2)
    json.top = top - (json.height / 2)
    await field.canvas.add(json)
    currentObjectInClipboard = undefined
    // field.canvas.renderAll.bind(field.canvas)
    // currentMousePosition
  }

  if (event.metaKey && isMac && event.ctrlKey && event.key === 't' || event.ctrlKey && event.key === 't' && !isMac) {
    const { left, top } = positionObject()
    
    await field.canvas.add(new IText(cadleShell.currentText, { 
      fontFamily: 'system-ui',
      fontSize: 12,
      fontStyle: 'normal',
      fontWeight: 'normal',
      controls: false,
      left,
      top
    }))

    if (cadleShell.inputType === 'normal') return



    const textMatch = cadleShell.currentText.match(/\D/g)

    if (cadleShell.inputType === 'alphabet') return cadleShell.currentText = incrementLetter(textMatch)

    const match = cadleShell.currentText.match(/\d+/g)
    
    if (match?.length > 0) {
      const number = Number(match.join(''))
      
      if (number && number === cadleShell.lastNumber) {
        cadleShell.lastNumber += 1
        if (cadleShell.lastNumber === 9 && globalThis.cadleShell.inputType === 'socket') {
          cadleShell.lastNumber = 1
          const textMatch = cadleShell.currentText.match(/\D/g)
          let text = ''
          
          if (textMatch?.length > 0) {
            if (textMatch.length > 1) {
              if (textMatch[1] === 'Z') {
                text = `${textMatch[0]}A`
              } else {
                text = `${textMatch[0]}${alphabet[alphabet.indexOf(textMatch[1].toLowerCase()) + 1].toUpperCase()}`
              }
              
            } else {
              if (textMatch[0] === 'Z') {
                text = 'AA'
              } else {
                text = alphabet[alphabet.indexOf(textMatch[0].toLowerCase()) + 1].toUpperCase()
              }
              
            }
          }
          cadleShell.currentText = `${text}${cadleShell.lastNumber}`
        } else cadleShell.currentText = cadleShell.currentText.replace(/\d+/g, String(cadleShell.lastNumber))
      }
    }
    
  }

  if (event.metaKey && isMac && event.key === 's' || event.ctrlKey && event.key === 's' && !isMac) {
    event.preventDefault()
    shell.save()
  }

  const moveObject = (object, direction: 'left' | 'right' | 'down' | 'up', amount) => {

    if (direction === 'left') object.left = Math.round((object.left - amount) *  100 ) / 100
    if (direction === 'right') object.left = Math.round((object.left + amount) *  100 ) / 100
    if (direction === 'up') object.top = Math.round((object.top - amount) *  100 ) / 100
    if (direction === 'down') object.top = Math.round((object.top + amount) *  100 ) / 100
  }

  const moveObjects = (direction: 'left' | 'right' | 'down' | 'up', amount?: number) => {
    amount = amount || 0.5
    let items = canvas.getActiveObjects()
    
    // canvas.discardActiveObject();

    for (const item of items) {
      if (item.type === 'activeselection') {
        canvas.remove(item)
        for (const _item of item._objects) {
          moveObject(_item, direction,  amount)
          canvas.setActiveObject(_item);
        }
      } else {
        moveObject(item, direction,  amount)
        canvas.setActiveObject(item);
      }
    }
    
  }

  if (event.metaKey && isMac && event.key === 'ArrowRight' && event.ctrlKey || event.ctrlKey && event.key === 'ArrowRight' && !isMac) {
    moveObjects('right')
  }

  if (event.metaKey && isMac && event.key === 'ArrowLeft' && event.ctrlKey || event.ctrlKey && event.key === 'ArrowLeft' && !isMac) {
    moveObjects('left')
  }

  if (event.metaKey && isMac && event.key === 'ArrowUp' && event.ctrlKey || event.ctrlKey && event.key === 'ArrowUp' && !isMac) {
    moveObjects('up')
  }

  if (event.metaKey && isMac && event.key === 'ArrowDown' && event.ctrlKey || event.ctrlKey && event.key === 'ArrowDown' && !isMac) {
    moveObjects('down')
  }
 

  field.canvas.renderAll()
  
  // console.log(event);
  
})