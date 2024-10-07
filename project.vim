set path=,,src/**,test/**,pkg-config/**/*.c

" reload config
nnoremap <Leader>r :source project.vim<CR>
" TODO make this autoload on write

" build
nnoremap <Leader>b :!npx tsc<CR>

" test
nnoremap <Leader>t :!npm run test<CR>
nnoremap <Leader>d :!open -a 'Google Chrome' chrome://inspect; node --inspect-brk ./node_modules/.bin/mocha<CR>
nnoremap <Leader>c :!npm run coverage; open coverage/index.html<CR>

" test buffers can cause clutter
function! DeleteTestBuffers() abort
    let buffers = getbufinfo()
    for buf in buffers
        if buf['name'] !=# '' && buf['name'] =~ '.*/test/.*.pc'
            silent! execute 'bdelete ' . buf['bufnr']
        endif
    endfor
endfunction

nnoremap <Leader>x :call DeleteTestBuffers()<CR>
