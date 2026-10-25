import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class CalculatorTest {
    @Test
    public void addsTwoValues() {
        Calculator calculator = new Calculator();
        assertEquals(42, calculator.add(19, 23));
    }
}
