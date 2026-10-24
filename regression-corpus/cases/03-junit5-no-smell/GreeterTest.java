import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class GreeterTest {
    @Test
    void returnsGreeting() {
        Greeter greeter = new Greeter();
        assertEquals("hello", greeter.greeting());
    }
}
