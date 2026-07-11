- lsp find references does not do anything
- lsp find defintions does not work on package level variables in Go and some other symbols ( review the lsp clicked symbol extraction)
- remove the title bar above the tab bar , no need for it.
- lister component: Merge explorer and the overlay palette inner component functionality into a new component called lister:
    the lister as it's name suggests can list a flat or nested list of items and provide a fast fuzzy search over it's items and render
    them beautifuly with out style. replace both explorer and palette internal lister with this component
    the only difference between these two should be where they will render. The internal
    component for the LocationList should also be replaced with a Lister.
    Lister something like this:
           // Each lister item just knows how to draw itself and how much space it needs both height and width.
           
           interface ListerItem { draw() }
    ofcourse this is more in rad immediate mode UI style, make it react style but the idea is the same
    A Lister:
         renders a list of items both nested (tree/explorer) and flat
         when lister has focus typing makes search on the items
         there is an optional flag whether to render a input text box for user search query ( like the palette ) but it's optional and not enabled in explorer usage.
    
- name ? icon ?
