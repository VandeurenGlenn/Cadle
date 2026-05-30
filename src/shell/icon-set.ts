import { html } from '@vandeurenglenn/lite'

/**
 * Symbol-icon registry consumed by `<custom-icon>` instances throughout the app.
 * Lives in its own module to keep the shell render template focused on layout.
 */
export const iconSetTemplate = html`
  <custom-icon-set>
    <template>
      <span name="abc">@symbol-abc</span>
      <span name="add">@symbol-add</span>
      <span name="check_box">@symbol-check_box</span>
      <span name="check_box_outline_blank">@symbol-check_box_outline_blank</span>
      <span name="delete">@symbol-delete</span>
      <span name="check">@symbol-check</span>
      <span name="menu">@symbol-menu</span>
      <span name="menu_open">@symbol-menu_open</span>
      <span name="shapes">@symbol-shapes</span>
      <span name="folder">@symbol-folder</span>
      <span name="keyboard">@symbol-keyboard</span>
      <span name="undo">@symbol-undo</span>
      <span name="redo">@symbol-redo</span>
      <span name="arrow_selector_tool">@symbol-arrow_selector_tool</span>
      <span name="grid_on">@symbol-grid_on</span>
      <span name="grid_off">@symbol-grid_off</span>
      <span name="draw">@symbol-draw</span>
      <span name="square">@symbol-square</span>
      <span name="circle">@symbol-circle</span>
      <span name="line_curve">@symbol-line_curve</span>
      <span name="horizontal_rule">@symbol-horizontal_rule</span>
      <span name="insert_text">@symbol-insert_text</span>
      <span name="tree_closed">@symbol-keyboard_arrow_right</span>
      <span name="tree_open">@symbol-keyboard_arrow_down</span>
      <span name="polyline">@symbol-polyline</span>
      <span name="save">@symbol-save</span>
      <span name="create_new_folder">@symbol-create_new_folder</span>
      <span name="folder_open">@symbol-folder_open</span>
      <span name="upload_file">@symbol-upload_file</span>
      <span name="download">@symbol-download</span>
      <span name="swap-vert">@symbol-swap_vert</span>
      <span name="swap-horiz">@symbol-swap_horiz</span>
      <span name="share">@symbol-share</span>
      <span name="more_vert">@symbol-more_vert</span>
      <span name="keyboard_arrow_down">@symbol-keyboard_arrow_down</span>
      <span name="keyboard_arrow_up">@symbol-keyboard_arrow_up</span>
      <span name="palette">@symbol-palette</span>
      <span name="border_color">@symbol-border_color</span>
      <span name="format_color_fill">@symbol-format_color_fill</span>
      <span name="opacity">@symbol-opacity</span>
      <span name="place_item">@symbol-place_item</span>
      <span name="output">@symbol-output</span>
      <span name="format_size">@symbol-format_size</span>
      <span name="open_with">@symbol-open_with</span>
      <span name="format_bold">@symbol-format_bold</span>
      <span name="format_italic">@symbol-format_italic</span>
      <span name="format_underlined">@symbol-format_underlined</span>
      <span name="format_align_center">@symbol-format_align_center</span>
      <span name="format_align_justify">@symbol-format_align_justify</span>
      <span name="format_align_left">@symbol-format_align_left</span>
      <span name="format_align_right">@symbol-format_align_right</span>
      <span name="format_indent_increase">@symbol-format_indent_increase</span>
      <span name="format_indent_decrease">@symbol-format_indent_decrease</span>
      <span name="format_list_bulleted">@symbol-format_list_bulleted</span>
      <span name="format_list_numbered">@symbol-format_list_numbered</span>
      <span name="format_quote">@symbol-format_quote</span>
      <span name="format_strikethrough">@symbol-format_strikethrough</span>
      <span name="format_clear">@symbol-format_clear</span>
      <span name="format_color_text">@symbol-format_color_text</span>
      <span name="format_paint">@symbol-format_paint</span>
      <span name="format_shapes">@symbol-format_shapes</span>
      <span name="format_size">@symbol-format_size</span>
      <span name="format_textdirection_l_to_r">@symbol-format_textdirection_l_to_r</span>
      <span name="format_textdirection_r_to_l">@symbol-format_textdirection_r_to_l</span>
      <span name="window">@symbol-window</span>
      <span name="width">@symbol-width</span>
      <span name="height">@symbol-height</span>
      <span name="measuring_tape">@symbol-measuring_tape</span>
      <span name="door_front">@symbol-door_front</span>
      <span name="polyline">@symbol-polyline</span>
      <span name="zoom_in">@symbol-zoom_in</span>
      <span name="zoom_out">@symbol-zoom_out</span>
      <span name="zoom_in_map">@symbol-zoom_in_map</span>
      <span name="fence">@symbol-fence</span>
      <span name="layers">@symbol-layers</span>
      <span name="link">@symbol-link</span>
      <span name="open_in_full">@symbol-open_in_full</span>
      <span name="text_fields">@symbol-text_fields</span>
      <span name="resize">@symbol-resize</span>
      <span name="straighten">@symbol-straighten</span>
      <span name="crop">@symbol-crop</span>
      <span name="crop_rotate">@symbol-crop_rotate</span>
      <span name="crop_square">@symbol-crop_square</span>
      <span name="filter_center_focus">@symbol-filter_center_focus</span>

      <span name="content_copy">@symbol-content_copy</span>
      <span name="content_cut">@symbol-content_cut</span>
      <span name="content_paste">@symbol-content_paste</span>
      <span name="delete_sweep">@symbol-delete_sweep</span>
    </template>
  </custom-icon-set>
`
