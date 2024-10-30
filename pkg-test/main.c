#include <hard_math.h>
#include <stdio.h>

int main() {
	int n = add_one(10);
	printf("add_one(10) = %d\n", n);
	return !(n == 11);
}
