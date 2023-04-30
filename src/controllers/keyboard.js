import { Object, util, IText } from 'fabric'

const isMac = navigator.userAgent.indexOf('Mac OS X') != -1

const shell = document.querySelector('app-shell')

const currentSelected = () => shell.renderRoot.querySelector('custom-pages').querySelector('draw-field.custom-selected')
let currentObjectInClipboard

addEventListener('keydown', async event => {
  
  if (event.metaKey && isMac || event.key === 'Delete' && !isMac) {
   if (event.key === 'Backspace') {
    const field = currentSelected()
    field.canvas.remove(field.canvas.getActiveObject())
   }
  }

  if (event.metaKey && isMac && event.key === 'c' || event.ctrlKey && event.key === 'c' && !isMac) {

    const field = currentSelected()
    currentObjectInClipboard = field.canvas.getActiveObject()
  }

  if (event.metaKey && isMac && event.key === 'x' || event.ctrlKey && event.key === 'x' && !isMac) {
    const field = currentSelected()
    currentObjectInClipboard = field.canvas.getActiveObject()
    field.canvas.remove(field.canvas.getActiveObject())
  }

  if (event.metaKey && isMac && event.key === 'v' || event.ctrlKey && event.key === 'v' && !isMac) {
    const json = await currentObjectInClipboard.cloneAsImage()
    let x = currentMousePosition.x - shell.drawer.getBoundingClientRect().width
    let y = currentMousePosition.y // - shell.header.width
    json.left = x - (json.width / 2)
    json.top = y - (json.height / 2)

    const field = currentSelected()
    console.log(json);
    await field.canvas.add(json)
    // field.canvas.renderAll.bind(field.canvas)
    // currentMousePosition
    console.log(json);
  }

  if (event.metaKey && isMac && event.ctrlKey && event.key === 't' || event.ctrlKey && event.key === 't' && !isMac) { 
   
    const field = currentSelected()
    await field.canvas.add(new IText('Tap and Type', { 
      fontFamily: 'arial black',
      fontSize: 12,
      left: currentMousePosition.x - shell.drawer.getBoundingClientRect().width, 
      top: currentMousePosition.y
    }))
  }

 

  
  
  console.log(event);
  
})