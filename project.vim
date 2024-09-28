set path=,,src/**,test/**

" build
nnoremap <Leader>b :!npx tsc<CR>

" test
nnoremap <Leader>t :!npx mocha dist/spec<CR>
